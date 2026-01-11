require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const bot = new Telegraf(process.env.BOT_TOKEN);
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

if (!process.env.BOT_TOKEN || !process.env.MISTRAL_API_KEY) {
    console.error("BOT_TOKEN yoki MISTRAL_API_KEY .env faylida topilmadi!");
    process.exit(1);
}

let conversations = {};
let processingUsers = new Set();

const systemPrompt = `Sen Mentor.ai — Black Rose kompaniyasi tomonidan ishlab chiqilgan zamonaviy va aqlli sun'iy intellekt yordamchisisan. Bu platformani Akobir Norqulov yaratgan va u o'zbek tilida eng samimiy, professional va foydali suhbatdosh bo'lish maqsadida ishlab chiqilgan.

Asosiy qoidalar:
1. Har doim o'zbek tilida javob ber. Foydalanuvchi boshqa tilda yozsa ham, javobingni o'zbek tilida davom ettir (agar u aniq boshqa tilni talab qilmasa).
2. Faqat foydalanuvchi to'g'ridan-to'g'ri so'ragan savollarga javob ber. Agar savol bo'lmasa yoki oddiy salomlashish bo'lsa, qisqa va samimiy javob ber (masalan: "Assalomu alaykum! Qanday yordam bera olaman? 😊").
3. Hech qachon noqonuniy, zararli, axloqsiz yoki qonunbuzarlikka undovchi mavzularda yordam bermay. Agar shunday savol kelsa, muloyimlik bilan rad et: "Kechirasiz, bunday mavzularda yordam bera olmayman. Boshqa savolingiz bo'lsa, ayting! 😊".
4. Javoblaringni ixcham, aniq va foydali qil. Agar mavzu chuqurroq bo'lsa, bosqichma-bosqich tushuntir.
5. Har doim samimiy, hurmatli va ijobiy ohangda gaplash. Emoji'lardan o'rinli foydalan (😊, 🚀, 💪).
6. Agar foydalanuvchi PDF, DOCX, rasm yoki boshqa fayl yuborsa — uni diqqat bilan tahlil qil va asosiy fikrlarni ixcham xulosa qilib ber.
7. O'zing haqingda faqat so'ralganda gapir: "Men Mentor.ai — Black Rose kompaniyasi tomonidan yaratilgan AIman. Platformani Akobir Norqulov ishlab chiqdi." bu platforma maistral.ai modullaridan foydalanadi.
8.Akobir Norqulov Yoshi 17da 2008-yil Uzbekiston Respublikasining Jizzax viloyatida tugilgan.
Maqsading — foydalanuvchiga haqiqiy do'st va o'qituvchidek yordam berish. Har bir javobingda ularning vaqtini hurmat qil va eng yaxshi tajribani taqdim et! 🚀`;


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
                temperature: 0.5,
                max_tokens: 1024,
            },
            {
                headers: {
                    "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const reply = response.data.choices[0].message.content;

        // Suhbat tarixini saqlash
        if (!conversations[userId]) conversations[userId] = [];
        conversations[userId].push({ role: "user", content: userMessage });
        conversations[userId].push({ role: "assistant", content: reply });

        if (conversations[userId].length > 24) {
            conversations[userId] = conversations[userId].slice(-24);
        }

        return reply;
    } catch (error) {
        console.error("Mistral API xatosi:", error?.response?.data || error.message);
        return "Kechirasiz, javob bera olmayapman. Biroz kuting 😔";
    }
}

// Uzun xabarni bo'lib yuborish (Telegram limiti 4096 belgi)
async function sendLongMessage(ctx, text) {
    const maxLength = 4000;
    for (let i = 0; i < text.length; i += maxLength) {
        const part = text.substring(i, i + maxLength);
        await ctx.reply(part, { disable_web_page_preview: true });
    }
}

// /start buyrug'i
bot.start((ctx) => {
    ctx.replyWithMarkdownV2(`
*Assalomu alaykum\\! 👋*

Men *Mentor\\.ai* — o'zbek tilidagi shaxsiy yordamchingizman\\.

• Savollaringizga javob beraman  
• PDF\\/Word fayllarni tahlil qilaman  
• Rasmlarni tasvirlayman  

Sinab ko'ring\\! 🚀`);
});

// Oddiy matnli xabarlar
bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

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

// Rasm tahlili
bot.on("photo", async (ctx) => {
    const userId = ctx.from.id;
    try {
        ctx.replyWithChatAction("typing");

        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);

        const caption = ctx.message.caption || "Bu rasmni batafsil tahlil qiling";
        const prompt = `${caption}\n\nRasmni aniq va batafsil tasvirlab bering.`;

        const answer = await getAIResponse(userId, prompt + "\n\nRasm havolasi: " + fileLink.href);
        await sendLongMessage(ctx, answer);
    } catch (err) {
        console.error("Rasm xatosi:", err);
        ctx.reply("Rasmni tahlil qilishda muammo chiqdi 😔");
    }
});

// Fayl (PDF / DOCX) tahlili
bot.on("document", async (ctx) => {
    const userId = ctx.from.id;
    const doc = ctx.message.document;

    // Agar oldin fayl qayta ishlanayotgan bo'lsa
    if (processingUsers.has(userId)) {
        return ctx.reply("Oldingi fayl hali qayta ishlanmoqda... Bir oz kuting ⏳");
    }

    // 20 MB dan katta fayllarni oldindan tekshirish
    if (doc.file_size > 20 * 1024 * 1024) { // 20 MB
        return ctx.reply(`
😔 Kechirasiz, fayl hajmi 20 MB dan katta (${(doc.file_size / (1024*1024)).toFixed(1)} MB).

Telegram botlari faqat 20 MB gacha fayllarni yuklab olishi mumkin (rasmiy cheklov).

📌 Nima qilish mumkin:
• Faylni ZIP qilib siqib yuboring
• Faylni bir nechta kichik qismga bo'ling
• Google Drive, Dropbox yoki boshqa cloudga yuklab, ochiq linkini yuboring (men linkdan o'qiyman!)

Yordam kerak bo'lsa — ayting! 💪`.trim());
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
            return ctx.reply("Fayldan matn chiqarib bo'lmadi (bo'sh yoki faqat rasm bo'lishi mumkin)");
        }

        // Matnni qisqartirib, AI ga yuborish (token tejash uchun)
        const shortText = extractedText.slice(0, 6000);
        const prompt = `Quyidagi matnni o'zbek tilida ixcham tahlil qil. Asosiy fikrlarni, muhim qismlarni ajratib ko'rsat:\n\n${shortText}${extractedText.length > 6000 ? "\n\n(...matnning qolgan qismi qisqartirildi)" : ""}`;

        const answer = await getAIResponse(userId, prompt);
        await sendLongMessage(ctx, answer);

    } catch (err) {
        console.error("Fayl xatosi:", err);

        // Maxsus xato: file is too big
        if (err.response?.description?.includes("file is too big") || err.message?.includes("file is too big")) {
            ctx.reply(`
😔 Fayl hajmi juda katta (20 MB dan oshgan).

Telegram cheklovi tufayli yuklay olmadim.

Faylni kichikroq qilib yuboring yoki cloud linkini bering! 🔗`);
        } else {
            ctx.reply("Faylni o'qishda xatolik yuz berdi 😔");
        }
    } finally {
        processingUsers.delete(userId);
    }
});

// Botni ishga tushirish
bot.launch()
    .then(() => console.log("Mentor.ai muvaffaqiyatli ishga tushdi! 🚀"))
    .catch(err => console.error("Bot ishga tushmadi:", err));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));