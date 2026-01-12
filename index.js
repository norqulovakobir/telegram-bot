require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const REQUIRED_CHANNEL = "@studyneedfuture";

if (!process.env.BOT_TOKEN || !process.env.MISTRAL_API_KEY) {
    console.error("BOT_TOKEN yoki MISTRAL_API_KEY .env faylida topilmadi!");
    process.exit(1);
}

let conversations = {};
let processingUsers = new Set();
let userMode = {}; // Foydalanuvchi rejimini saqlash

const systemPrompt = `Sen Mentor.ai — Black Rose kompaniyasi tomonidan ishlab chiqilgan zamonaviy va aqlli sun'iy intellekt yordamchisisan. Bu platformani Akobir Norqulov yaratgan va u o'zbek tilida eng samimiy, professional va foydali suhbatdosh bo'lish maqsadida ishlab chiqilgan.

Asosiy qoidalar:
1. Foydalanuvchi qaysi tilda yozsa shu tilda javob ber.
2. Javoblaringni QISQA va ANIQ qil. Har bir javob 2-4 jumla bo'lsin (30-80 so'z).
3. Foydalanuvchi "batafsil", "to'liq", "keng", "tariflab" so'zlarini ishlatgandagina uzoqroq javob ber.
4. Agar savol bo'lmasa yoki oddiy salomlashish bo'lsa, juda qisqa javob ber: "Assalomu alaykum! Yordam kerakmi? 😊"
5. Hech qachon noqonuniy, zararli yoki axloqsiz mavzularda yordam berma.
6. Emoji'lardan kam foydalanish (har 2-3 jumlada bitta).
7. O'zing haqingda faqat so'ralganda gapir: "Men Mentor.ai — Black Rose kompaniyasi tomonidan yaratilgan AI. Platformani Akobir Norqulov ishlab chiqdi. mistral.ai modullari asosida ishlayman."
8. Akobir Norqulov 2008-yil Jizzax viloyatida tug'ilgan, hozir 17 yoshda.
9.bitta so'zni doim takrorlama bu foydalanuvchiga zerikarli hushmomila bolgin doim. insondek suhbat qilgin.foydalanuvching kayfiyatiga qarab emoji reaksiya ishlat.
Maqsad: Tez, aniq va foydali javoblar berish. 🚀`;

// Kanal a'zoligini tekshirish
async function checkChannelMembership(ctx) {
    try {
        const userId = ctx.from.id;
        const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, userId);
        const isSubscribed = ['member', 'administrator', 'creator'].includes(member.status);
        console.log(`User ${userId} kanal holati: ${member.status} - A'zo: ${isSubscribed}`);
        return isSubscribed;
    } catch (error) {
        console.error("Kanal tekshirish xatosi:", error.message);
        console.error("Kanal:", REQUIRED_CHANNEL);
        // Xato bo'lsa ham false qaytarish (botni buzilishdan saqlash)
        return false;
    }
}

// A'zolik kerak xabari
async function sendSubscriptionRequired(ctx) {
    await ctx.reply(
        `🔒 Botdan foydalanish uchun kanalimizga a'zo bo'ling:\n\n` +
        `👉 ${REQUIRED_CHANNEL}\n\n` +
        `A'zo bo'lgandan keyin /start ni qayta bosing! 😊`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📢 Kanalga o'tish", url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }],
                    [{ text: "✅ Tekshirish", callback_data: "check_subscription" }]
                ]
            }
        }
    );
}

async function getAIResponse(userId, userMessage) {
    try {
        const messages = [
            { role: "system", content: systemPrompt },
            ...(conversations[userId] || []).slice(-10),
            { role: "user", content: userMessage }
        ];

        const response = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            {
                model: "mistral-large-latest",
                messages,
                temperature: 0.3, // Tezroq javob uchun kamaytirildi
                max_tokens: 250, // Qisqa va tez javoblar
            },
            {
                headers: {
                    "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 15000 // 15 soniya timeout
            }
        );

        const reply = response.data.choices[0].message.content;

        if (!conversations[userId]) conversations[userId] = [];
        conversations[userId].push({ role: "user", content: userMessage });
        conversations[userId].push({ role: "assistant", content: reply });

        if (conversations[userId].length > 20) {
            conversations[userId] = conversations[userId].slice(-20);
        }

        return reply;
    } catch (error) {
        console.error("Mistral API xatosi:", error?.response?.data || error.message);
        return "Kechirasiz, javob bera olmayapman. Biroz kuting 😔";
    }
}

// Rasm generatsiya qilish (Mistral Pixtral)
async function generateImage(prompt) {
    try {
        const response = await axios.post(
            "https://api.mistral.ai/v1/images/generations",
            {
                model: "pixtral-12b-2409",
                prompt: prompt,
                n: 1,
                size: "1024x1024"
            },
            {
                headers: {
                    "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 30000 // 30 soniya
            }
        );

        return response.data.data[0].url;
    } catch (error) {
        console.error("Rasm generatsiya xatosi:", error?.response?.data || error.message);
        return null;
    }
}

async function sendLongMessage(ctx, text) {
    const maxLength = 4000;
    for (let i = 0; i < text.length; i += maxLength) {
        const part = text.substring(i, i + maxLength);
        await ctx.reply(part, { disable_web_page_preview: true });
    }
}

// /start buyrug'i
bot.start(async (ctx) => {
    const isMember = await checkChannelMembership(ctx);
    
    if (!isMember) {
        return sendSubscriptionRequired(ctx);
    }

    ctx.reply(
        `Assalomu alaykum! 👋\n\n` +
        `Men Mentor.ai — o'zbek tilidagi yordamchingiz.\n\n` +
        `📋 Buyruqlar:\n` +
        `/generate - Rasm yaratish 🎨\n` +
        `/analyze - Fayl tahlil qilish 📄\n` +
        `/edit - Matnni tahrirlash ✏️\n` +
        `/help - Yordam 💡\n\n` +
        `Savol bering yoki buyruq tanlang! 🚀`
    );
});

// /help buyrug'i
bot.command('help', async (ctx) => {
    const isMember = await checkChannelMembership(ctx);
    if (!isMember) return sendSubscriptionRequired(ctx);

    ctx.reply(
        `📖 Yordam bo'limi:\n\n` +
        `💬 Oddiy savol - Matn yuboring\n` +
        `🖼 Rasm tahlil - Rasm yuboring\n` +
        `📄 Fayl tahlil - PDF/DOCX yuboring\n` +
        `🎨 Rasm yaratish - /generate buyrug'i\n` +
        `✏️ Matn tahrirlash - /edit buyrug'i\n\n` +
        `Misol:\n` +
        `/generate katta tog' va quyosh\n` +
        `/edit Bu matnni qisqartir: [sizning matningiz]`
    );
});

// /generate buyrug'i (Rasm yaratish)
bot.command('generate', async (ctx) => {
    const isMember = await checkChannelMembership(ctx);
    if (!isMember) return sendSubscriptionRequired(ctx);

    const prompt = ctx.message.text.replace('/generate', '').trim();
    
    if (!prompt) {
        return ctx.reply(
            `🎨 Rasm yaratish uchun tavsifni yozing:\n\n` +
            `Misol:\n` +
            `/generate katta tog' va quyosh\n` +
            `/generate go'zal bog' va gul`
        );
    }

    try {
        ctx.replyWithChatAction("upload_photo");
        await ctx.reply("🎨 Rasm yaratilmoqda... Biroz kuting ⏳");

        const imageUrl = await generateImage(prompt);
        
        if (imageUrl) {
            await ctx.replyWithPhoto(imageUrl, {
                caption: `✅ Rasm tayyor!\n\nTavsif: ${prompt}`
            });
        } else {
            ctx.reply("😔 Rasm yaratishda xatolik yuz berdi. Qayta urinib ko'ring.");
        }
    } catch (err) {
        console.error("Generate xatosi:", err);
        ctx.reply("Rasm yaratishda muammo chiqdi 😔");
    }
});

// /analyze buyrug'i (Fayl tahlil)
bot.command('analyze', async (ctx) => {
    const isMember = await checkChannelMembership(ctx);
    if (!isMember) return sendSubscriptionRequired(ctx);

    userMode[ctx.from.id] = 'analyze';
    ctx.reply(
        `📄 Tahlil qilish rejimi yoqildi!\n\n` +
        `Endi PDF yoki DOCX fayl yuboring.\n` +
        `Men uni tahlil qilaman 🔍`
    );
});

// /edit buyrug'i (Matn tahrirlash)
bot.command('edit', async (ctx) => {
    const isMember = await checkChannelMembership(ctx);
    if (!isMember) return sendSubscriptionRequired(ctx);

    const text = ctx.message.text.replace('/edit', '').trim();
    
    if (!text) {
        return ctx.reply(
            `✏️ Matn tahrirlash:\n\n` +
            `Misol:\n` +
            `/edit Bu matnni qisqartir: Lorem ipsum dolor...\n` +
            `/edit Bu matnni o'zbekchaga tarjima qil: Hello world`
        );
    }

    try {
        ctx.replyWithChatAction("typing");
        const answer = await getAIResponse(ctx.from.id, `Quyidagi matnni tahrirlash kerak: ${text}`);
        await sendLongMessage(ctx, answer);
    } catch (err) {
        console.error("Edit xatosi:", err);
        ctx.reply("Tahrirlashda xatolik yuz berdi");
    }
});

// Callback handler
bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    const isMember = await checkChannelMembership(ctx);
    
    if (isMember) {
        ctx.reply(`✅ A'zolik tasdiqlandi!\n\nEndi botdan foydalanishingiz mumkin 😊`);
    } else {
        ctx.reply(`❌ Siz hali kanalga a'zo emassiz. Iltimos, avval a'zo bo'ling! 📢`);
    }
});

// Oddiy matnli xabarlar
bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    const isMember = await checkChannelMembership(ctx);
    if (!isMember) return sendSubscriptionRequired(ctx);

    const userId = ctx.from.id;
    const text = ctx.message.text;

    try {
        ctx.replyWithChatAction("typing");
        const answer = await getAIResponse(userId, text);
        await sendLongMessage(ctx, answer);
    } catch (err) {
        console.error("Matn xatosi:", err);
        ctx.reply("Xatolik yuz berdi. Qayta urinib ko'ring");
    }
});

// Rasm tahlili (Mistral Vision API)
bot.on("photo", async (ctx) => {
    const isMember = await checkChannelMembership(ctx);
    if (!isMember) return sendSubscriptionRequired(ctx);

    const userId = ctx.from.id;
    try {
        ctx.replyWithChatAction("typing");

        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        
        const caption = ctx.message.caption || "Bu rasmni qisqacha tahlil qil va o'zbek tilida yoz";

        // Mistral Vision API (Pixtral model) bilan ishlash
        const response = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            {
                model: "pixtral-12b-2409", // Vision model
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: caption },
                            { type: "image_url", image_url: fileLink.href }
                        ]
                    }
                ],
                max_tokens: 250,
                temperature: 0.3
            },
            {
                headers: {
                    "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 20000 // 20 soniya
            }
        );

        const answer = response.data.choices[0].message.content;
        await sendLongMessage(ctx, answer);

    } catch (err) {
        console.error("Rasm xatosi:", err?.response?.data || err.message);
        ctx.reply("Rasmni tahlil qilishda muammo chiqdi 😔");
    }
});

// Fayl (PDF / DOCX) tahlili
bot.on("document", async (ctx) => {
    const isMember = await checkChannelMembership(ctx);
    if (!isMember) return sendSubscriptionRequired(ctx);

    const userId = ctx.from.id;
    const doc = ctx.message.document;

    if (processingUsers.has(userId)) {
        return ctx.reply("Oldingi fayl hali qayta ishlanmoqda... Bir oz kuting ⏳");
    }

    if (doc.file_size > 20 * 1024 * 1024) {
        return ctx.reply(
            `😔 Fayl hajmi 20 MB dan katta (${(doc.file_size / (1024*1024)).toFixed(1)} MB).\n\n` +
            `Telegram cheklovi: 20 MB. Faylni kichikroq qilib yuboring 🔗`
        );
    }

    processingUsers.add(userId);

    try {
        ctx.replyWithChatAction("typing");

        const fileName = (doc.file_name || "").toLowerCase();
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);

        const response = await axios.get(fileLink.href, { responseType: "arraybuffer" });
        const buffer = Buffer.from(response.data);

        let extractedText = "";

        if (fileName.endsWith(".pdf")) {
            const data = await pdf(buffer);
            extractedText = data.text;
        } else if (fileName.endsWith(".docx")) {
            const result = await mammoth.extractRawText({ buffer });
            extractedText = result.value;
        } else {
            return ctx.reply("Hozircha faqat .pdf va .docx fayllarni tahlil qila olaman 😅");
        }

        if (!extractedText.trim()) {
            return ctx.reply("Fayldan matn chiqarib bo'lmadi");
        }

        const shortText = extractedText.slice(0, 4000);
        const prompt = `Quyidagi fayl matnini o'zbek tilida QISQA tahlil qil (3-5 jumla). Faqat asosiy fikrlarni yoz:\n\n${shortText}`;

        const answer = await getAIResponse(userId, prompt);
        
        await ctx.reply(`📄 Fayl: ${doc.file_name}\n📊 Hajmi: ${(doc.file_size / 1024).toFixed(1)} KB\n\n${answer}`);

    } catch (err) {
        console.error("Fayl xatosi:", err);
        ctx.reply("Faylni o'qishda xatolik yuz berdi 😔");
    } finally {
        processingUsers.delete(userId);
    }
});

// Botni ishga tushirish
const app = express();
const PORT = process.env.PORT || 3001; // 3000 dan 3001 ga o'zgardi

// Health check endpoint (Render uchun)
app.get('/', (req, res) => {
    res.send('Mentor.ai bot ishlayapti! 🚀');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'running' });
});

// HTTP server ishga tushirish
app.listen(PORT, () => {
    console.log(`HTTP server ${PORT} portda ishga tushdi`);
});

// Telegram botni ishga tushirish
bot.launch()
    .then(() => console.log("Mentor.ai muvaffaqiyatli ishga tushdi! 🚀"))
    .catch(err => console.error("Bot ishga tushmadi:", err));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));