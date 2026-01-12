require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ytdl = require('ytdl-core');
const ytSearch = require('youtube-search-api');
const gTTS = require('gtts');
const cheerio = require('cheerio');

// ======================== ASOSIY SOZLAMALAR ========================
const BOT_TOKEN = process.env.BOT_TOKEN;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const REQUIRED_CHANNEL = "@studyneedfuture";

if (!BOT_TOKEN || !MISTRAL_API_KEY) {
    console.error("❌ Xato: BOT_TOKEN yoki MISTRAL_API_KEY topilmadi!");
    console.error("📝 .env faylini tekshiring");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ======================== GLOBAL MA'LUMOTLAR ========================
let conversations = {};
let processingUsers = new Set();
let userMode = {};
let userLastActive = {};
let scheduledMessages = {};

// ======================== EMOJI VA XABARLAR ========================
const EMOJIS = {
    greeting: ['👋', '😊', '🌟', '✨', '💫', '🎉', '🤗', '😄', '🙌', '💪'],
    thinking: ['🤔', '💭', '🧐', '🤨', '😌', '💡'],
    happy: ['😊', '😄', '🥰', '😍', '🤩', '💖', '❤️', '💕'],
    sad: ['😢', '😔', '🥺', '😞', '💔', '😪'],
    excited: ['🎉', '🎊', '🥳', '🤗', '✨', '🌟', '💫', '🎈']
};

const QUESTIONS = [
    "Salom! Qalaysiz? Bugun qanday o'tdi? 😊",
    "Assalomu alaykum! Ishlaringiz qanday ketayapti? 💼",
    "Salom! Meni unutdingizmi? 🥺 Bugun nima qildingiz?",
    "Qaleysan! Bugun kayfiyat qanday? 🌟",
    "Salom do'stim! Nima gap? ✨",
    "Assalom! Bugun qiziq narsa bo'ldimi? 🤔",
    "Hey! Meni esladingizmi? 😄 Qanday o'tkazyapsiz?",
    "Salom! Yaxshi dam olyapsizmi? 🏖️",
    "Qalesan! Hozir nima qilyapsiz? 💭",
    "Assalom! Nimaga kutyapsiz? Rejalaringiz bormi? 📅"
];

const systemPrompt = `Sen Mentor.ai — Black Rose kompaniyasi tomonidan ishlab chiqilgan juda samimiy va do'stona sun'iy intellekt yordamchisisan. Platformani Akobir Norqulov yaratgan.

MUHIM QOIDALAR:
1. Har doim noqonuniy narsalarga yordam berman targib etma.
2. Biroz samimiy va do'stona bo'l
3. Har javobda 1-2 ta emoji ishlatish foydalanuvchi kayfiyatiga qarab
4. Javoblar qisqa bo'lsin (2-4 jumla, 30-80 so'z)
5. Faqat "batafsil" deb so'ralgandagina uzoq javob ber
6. Real inson kabi gapir, rasmiy bo'lma
7. Hazil qil, foydalanuvchini doim ismi bilan chaaqir
8. Foydalanuvchining his-tuyg'ulariga e'tibor ber
9. Sen AI uztozsan  juda hzilkasham juda zerikarli ham bolmasliging kerak.
Xarakter: Samimiy, mehribon, Biroz Jiddiy , biroz hazilkash, do'stona, g'amxo'r`;

// ======================== YORDAMCHI FUNKSIYALAR ========================

function randomEmoji(type) {
    const arr = EMOJIS[type] || EMOJIS.happy;
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomQuestion() {
    return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
}

function nextRandomTime() {
    const hours = 24 + Math.random() * 24; // 1-2 kun
    return Date.now() + (hours * 60 * 60 * 1000);
}

async function checkChannel(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (err) {
        console.error("Kanal tekshirishda xato:", err.message);
        return false;
    }
}

async function askSubscribe(ctx) {
    return ctx.reply(
        `🔒 Botdan foydalanish uchun kanalga a'zo bo'ling:\n\n👉 ${REQUIRED_CHANNEL}\n\nA'zo bo'lib, /start ni qayta bosing! 😊`,
        {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📢 Kanalga o'tish", url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }],
                    [{ text: "✅ Tekshirish", callback_data: "check_sub" }]
                ]
            }
        }
    );
}

// ======================== AI JAVOB OLISH ========================
async function getAI(userId, message, name = null) {
    try {
        if (!conversations[userId]) conversations[userId] = [];
        
        const msgs = [
            { role: "system", content: systemPrompt },
            ...conversations[userId].slice(-10),
            { role: "user", content: name ? `[${name}]: ${message}` : message }
        ];

        const res = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            {
                model: "mistral-large-latest",
                messages: msgs,
                temperature: 0.7,
                max_tokens: 300
            },
            {
                headers: {
                    "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 15000
            }
        );

        const reply = res.data.choices[0].message.content.trim();

        conversations[userId].push({ role: "user", content: message });
        conversations[userId].push({ role: "assistant", content: reply });
        
        if (conversations[userId].length > 20) {
            conversations[userId] = conversations[userId].slice(-20);
        }

        return reply;
    } catch (err) {
        console.error("Mistral xatosi:", err.message);
        return `Voy! ${randomEmoji('sad')} Javob bera olmayapman. Biroz kuting va qayta urining! 🙏`;
    }
}

// ======================== MATNNI OVOZGA ========================
async function textToVoice(text) {
    return new Promise((resolve, reject) => {
        try {
            const cleanText = text.replace(/[🎵🎤⏱✅😊🥰💖❤️💕😄🤗🎉🎊🥳✨🌟💫🎈👋😔🥺😞💔😪🤔💭🧐🤨😌💡📄📝🖼🎨✏️🔍📥📢🔒]/g, '');
            const tts = new gTTS(cleanText, 'uz');
            const file = path.join(__dirname, `voice_${Date.now()}.mp3`);
            tts.save(file, (err) => {
                if (err) reject(err);
                else resolve(file);
            });
        } catch (err) {
            reject(err);
        }
    });
}

// ======================== LINKLAR ========================
function getUrls(text) {
    const regex = /(https?:\/\/[^\s]+)/g;
    return text.match(regex) || [];
}

async function downloadInsta(url) {
    try {
        const res = await axios.post(
            'https://v3.igdownloader.app/api/ajaxDownload',
            new URLSearchParams({ link: url }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            }
        );
        const $ = cheerio.load(res.data.data);
        return $('a.download-btn').attr('href') || null;
    } catch (err) {
        console.error("Instagram xatosi:", err.message);
        return null;
    }
}

async function downloadTikTok(url) {
    try {
        const res = await axios.get('https://www.tikwm.com/api/', {
            params: { url },
            timeout: 15000
        });
        return res.data.code === 0 ? res.data.data.play : null;
    } catch (err) {
        console.error("TikTok xatosi:", err.message);
        return null;
    }
}

async function searchMusic(ctx, query) {
    try {
        await ctx.reply(`🔍 "${query}" qidirilmoqda... ${randomEmoji('thinking')}`);
        
        const results = await ytSearch.GetListByKeyword(query, false, 5);
        if (!results?.items?.length) {
            return ctx.reply(`Topilmadi ${randomEmoji('sad')} Boshqa nom bilan qidiring!`);
        }

        const video = results.items[0];
        const info = await ytdl.getInfo(`https://youtube.com/watch?v=${video.id}`);
        const audio = ytdl.downloadFromInfo(info, { filter: 'audioonly', quality: 'highestaudio' });

        await ctx.replyWithAudio(
            { source: audio },
            {
                caption: `🎵 ${video.title}\n🎤 ${video.channelTitle || 'Noma\'lum'}\n⏱ ${video.length?.text || 'N/A'}\n\nMana sizga! ${randomEmoji('happy')}`,
                title: video.title,
                performer: video.channelTitle || 'Noma\'lum'
            }
        );
    } catch (err) {
        console.error("Musiqa xatosi:", err.message);
        ctx.reply(`Voy! ${randomEmoji('sad')} Yuklab bo'lmadi. Qayta urining!`);
    }
}

async function generateImg(prompt) {
    try {
        const res = await axios.post(
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
                timeout: 40000
            }
        );
        return res.data.data[0].url;
    } catch (err) {
        console.error("Rasm xatosi:", err.message);
        return null;
    }
}

async function sendLong(ctx, text) {
    const max = 4000;
    for (let i = 0; i < text.length; i += max) {
        await ctx.reply(text.substring(i, i + max), { disable_web_page_preview: true });
        if (i + max < text.length) await new Promise(r => setTimeout(r, 500));
    }
}

// ======================== AVTOMATIK XABARLAR ========================
async function sendAuto(userId) {
    try {
        await bot.telegram.sendMessage(userId, randomQuestion());
        console.log(`✅ Avtomatik xabar: ${userId}`);
        scheduleNext(userId);
    } catch (err) {
        console.error(`Avtomatik xabar xatosi (${userId}):`, err.message);
        if (scheduledMessages[userId]) {
            clearTimeout(scheduledMessages[userId]);
            delete scheduledMessages[userId];
        }
    }
}

function scheduleNext(userId) {
    if (scheduledMessages[userId]) clearTimeout(scheduledMessages[userId]);
    
    const next = nextRandomTime();
    const delay = next - Date.now();
    
    scheduledMessages[userId] = setTimeout(() => sendAuto(userId), delay);
    console.log(`⏰ Keyingi xabar ${userId} uchun ${(delay / 3600000).toFixed(1)} soatdan keyin`);
}

function updateActivity(userId) {
    userLastActive[userId] = Date.now();
    if (!scheduledMessages[userId]) scheduleNext(userId);
}

// ======================== BOT BUYRUQLARI ========================

bot.start(async (ctx) => {
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);
    
    const name = ctx.from.first_name || "Do'stim";
    updateActivity(ctx.from.id);

    ctx.reply(
        `Assalomu alaykum, ${name}! ${randomEmoji('greeting')}${randomEmoji('excited')}\n\n` +
        `Men Mentor.ai — sizning yaqin yordamchingiz! 🤖💙\n\n` +
        `📋 Nima qilaman:\n\n` +
        `💬 Suhbat - Gap bering!\n` +
        `🎨 Rasm yaratish - /generate\n` +
        `📄 Fayl tahlil - PDF/DOCX yuboring\n` +
        `✏️ Matn tahrirlash - /edit\n` +
        `🎵 Musiqa - "qo'shiq" deb yozing\n` +
        `📥 Video - Link yuboring\n` +
       
        `Yordam: /help 🚀✨\n\n` +
        `Gaplashaylik? ${randomEmoji('happy')}`
    );
});

bot.command('help', async (ctx) => {
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);
    updateActivity(ctx.from.id);

    ctx.reply(
        `📖 Yordam ${randomEmoji('thinking')}\n\n` +
        `💬 Savol - Yozing, javob beraman\n` +
        `🖼 Rasm - Rasm yuboring\n` +
        `📄 Fayl - PDF/DOCX yuboring\n` +
        `🎨 Rasm yaratish - /generate [tavsif]\n` +
        `✏️ Tahrirlash - /edit [matn]\n` +
        `🎵 Musiqa - "qo'shiq [nom]"\n` +
        `📥 Video - Link yuboring\n\n` +
        `Misol:\n` +
        `"qo'shiq Shahzoda" 🎶\n` +
        `"/generate go'zal tog'" 🌅\n\n` +
        `Savol bor? So'rang! ${randomEmoji('happy')}`
    );
});

bot.command('generate', async (ctx) => {
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);
    updateActivity(ctx.from.id);

    const prompt = ctx.message.text.replace('/generate', '').trim();
    if (!prompt) {
        return ctx.reply(
            `🎨 Tavsif yozing! ${randomEmoji('thinking')}\n\n` +
            `Misol:\n/generate go'zal tog'\n/generate kosmik kema\n\n` +
            `Nima yasatmoqchisiz? ${randomEmoji('excited')}`
        );
    }

    try {
        await ctx.reply(`🎨 Yaratilmoqda... ${randomEmoji('excited')} Kuting!`);
        const url = await generateImg(prompt);
        
        if (url) {
            await ctx.replyWithPhoto(url, { 
                caption: `✅ Tayyor! ${randomEmoji('happy')}\nTavsif: ${prompt}` 
            });
        } else {
            ctx.reply(`Voy! ${randomEmoji('sad')} Yarata olmadim. Qayta urining!`);
        }
    } catch (err) {
        ctx.reply(`Xato! ${randomEmoji('sad')} Qayta urining!`);
    }
});

bot.command('edit', async (ctx) => {
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);
    updateActivity(ctx.from.id);

    const text = ctx.message.text.replace('/edit', '').trim();
    if (!text) {
        return ctx.reply(
            `✏️ Matn yozing! ${randomEmoji('thinking')}\n\n` +
            `Misol:\n/edit Bu matnni qisqartir: [matn]\n\n` +
            `Yordam kerakmi? ${randomEmoji('happy')}`
        );
    }

    try {
        ctx.replyWithChatAction("typing");
        const answer = await getAI(ctx.from.id, `Matnni tahrirla: ${text}`, ctx.from.first_name);
        await sendLong(ctx, answer);
    } catch (err) {
        ctx.reply(`Xato! ${randomEmoji('sad')} Qayta urining!`);
    }
});

bot.command('analyze', async (ctx) => {
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);
    updateActivity(ctx.from.id);
    
    userMode[ctx.from.id] = 'analyze';
    ctx.reply(`📄 Tahlil rejimi! ${randomEmoji('excited')}\n\nEndi fayl yuboring!`);
});

bot.action('check_sub', async (ctx) => {
    await ctx.answerCbQuery();
    const ok = await checkChannel(ctx);
    
    if (ok) {
        updateActivity(ctx.from.id);
        ctx.reply(`✅ Tasdiqlandi! ${randomEmoji('happy')}\n/start ni bosing!`);
    } else {
        ctx.reply(`❌ Hali a'zo emassiz ${randomEmoji('sad')}\nKanalga o'ting!`);
    }
});

// ======================== TEXT HANDLER ========================
bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);

    updateActivity(ctx.from.id);

    const text = ctx.message.text;
    const lower = text.toLowerCase();
    const urls = getUrls(text);
    const name = ctx.from.first_name || "Do'stim";

    // Linklar
    if (urls.length > 0) {
        for (const url of urls) {
            try {
                if (url.includes('instagram.com')) {
                    await ctx.reply(`📥 Instagram... ${randomEmoji('excited')}`);
                    const link = await downloadInsta(url);
                    if (link) {
                        await ctx.replyWithVideo({ url: link }, { caption: `✅ Instagram! ${randomEmoji('happy')}` });
                    } else {
                        await ctx.reply(`Topilmadi ${randomEmoji('sad')}`);
                    }
                } else if (url.includes('tiktok.com')) {
                    await ctx.reply(`📥 TikTok... ${randomEmoji('excited')}`);
                    const link = await downloadTikTok(url);
                    if (link) {
                        await ctx.replyWithVideo({ url: link }, { caption: `✅ TikTok! ${randomEmoji('happy')}` });
                    } else {
                        await ctx.reply(`Topilmadi ${randomEmoji('sad')}`);
                    }
                } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
                    await ctx.reply(`📥 YouTube... ${randomEmoji('thinking')}`);
                    const info = await ytdl.getInfo(url);
                    const audio = ytdl.downloadFromInfo(info, { filter: 'audioonly' });
                    await ctx.replyWithAudio({ source: audio }, { caption: `✅ YouTube! ${randomEmoji('happy')}` });
                }
            } catch (err) {
                await ctx.reply(`Xato! ${randomEmoji('sad')}`);
            }
        }
        return;
    }

    // Musiqa
    if (lower.includes("qo'shiq") || lower.includes("musiqa")) {
        const query = text.replace(/qo'shiq|musiqa|ber|ayt|top/gi, '').trim();
        if (query.length > 2) return searchMusic(ctx, query);
    }

    // Oddiy suhbat
    try {
        ctx.replyWithChatAction("typing");
        const answer = await getAI(ctx.from.id, text, name);
        await sendLong(ctx, answer);

        // Ovozli javob
        try {
            const voice = await textToVoice(answer);
            await ctx.replyWithVoice({ source: voice });
            fs.unlinkSync(voice);
        } catch (vErr) {
            console.log("Ovoz xatosi:", vErr.message);
        }
    } catch (err) {
        ctx.reply(`Xato! ${randomEmoji('sad')} Qayta yozing!`);
    }
});

// ======================== PHOTO HANDLER ========================
bot.on("photo", async (ctx) => {
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);
    updateActivity(ctx.from.id);

    try {
        await ctx.reply(`🖼 Ko'ryapman... ${randomEmoji('thinking')}`);
        ctx.replyWithChatAction("typing");
        
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const link = await ctx.telegram.getFileLink(photo.file_id);
        const caption = ctx.message.caption || "Bu rasmni o'zbek tilida tahlil qil. Ko'p emoji ishlatib samimiy bo'l!";

        const res = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            {
                model: "pixtral-12b-2409",
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: caption },
                        { type: "image_url", image_url: link.href }
                    ]
                }],
                max_tokens: 400,
                temperature: 0.7
            },
            {
                headers: {
                    "Authorization": `Bearer ${MISTRAL_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 25000
            }
        );

        const answer = res.data.choices[0].message.content;
        await sendLong(ctx, `${answer}\n\n${randomEmoji('happy')} Yoqdimi?`);
    } catch (err) {
        ctx.reply(`Xato! ${randomEmoji('sad')}`);
    }
});

// ======================== DOCUMENT HANDLER ========================
bot.on("document", async (ctx) => {
    if (!(await checkChannel(ctx))) return askSubscribe(ctx);

    const doc = ctx.message.document;
    const userId = ctx.from.id;
    const name = ctx.from.first_name || "Do'stim";

    updateActivity(userId);

    if (processingUsers.has(userId)) {
        return ctx.reply(`Sabr qiling! ${randomEmoji('thinking')}`);
    }

    if (doc.file_size > 20 * 1024 * 1024) {
        return ctx.reply(`Katta! ${randomEmoji('sad')} 20 MB dan kichik yuboring!`);
    }

    processingUsers.add(userId);
    
    try {
        await ctx.reply(`📄 O'qiyapman... ${randomEmoji('excited')}`);
        
        const fileName = (doc.file_name || "").toLowerCase();
        const link = await ctx.telegram.getFileLink(doc.file_id);
        const res = await axios.get(link.href, { responseType: "arraybuffer", timeout: 30000 });
        const buffer = Buffer.from(res.data);

        let text = "";

        if (fileName.endsWith(".pdf")) {
            const data = await pdfParse(buffer);
            text = data.text;
        } else if (fileName.endsWith(".docx")) {
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
        } else {
            processingUsers.delete(userId);
            return ctx.reply(`Faqat PDF va DOCX! ${randomEmoji('sad')}`);
        }

        if (!text.trim()) {
            processingUsers.delete(userId);
            return ctx.reply(`Bo'sh fayl! ${randomEmoji('sad')}`);
        }

        const short = text.slice(0, 6000);
        const prompt = `${name} fayl yubordi. O'zbek tilida tahlil qil, ko'p emoji ishlatib samimiy bo'l:\n\n${short}`;

        ctx.replyWithChatAction("typing");
        const answer = await getAI(userId, prompt, name);
        
        await ctx.reply(`📄 ${doc.file_name}\n${randomEmoji('happy')}\n\n${answer}`);
        
    } catch (err) {
        ctx.reply(`Xato! ${randomEmoji('sad')}`);
    } finally {
        processingUsers.delete(userId);
    }
});

// ======================== XATOLIK HANDLER ========================
bot.catch((err, ctx) => {
    console.error(`❌ Bot xatosi:`, err);
    try {
        ctx.reply(`Xato! ${randomEmoji('sad')} /start bosing!`);
    } catch (e) {}
});

// ======================== SERVER ========================
const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><title>Mentor.ai</title>
        <style>
            body{font-family:Arial;background:linear-gradient(135deg,#667eea,#764ba2);
            color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
            .box{text-align:center;padding:40px;background:rgba(255,255,255,.1);
            border-radius:20px;backdrop-filter:blur(10px)}
            h1{font-size:3em;margin:0}p{font-size:1.2em;margin:20px 0}
            .ok{color:#4ade80;font-weight:bold;font-size:1.5em}
        </style></head><body>
        <div class="box">
            <h1>🤖 Mentor.ai</h1>
            <p class="ok">✅ Ishlayapti!</p>
            <p>O'zbek tilidagi AI yordamchi</p>
            <p>Black Rose | Akobir Norqulov</p>
        </div></body></html>
    `);
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        users: Object.keys(userLastActive).length,
        scheduled: Object.keys(scheduledMessages).length
    });
});

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════╗
║   🤖 MENTOR.AI ISHGA     ║
║      TUSHDI! ✅          ║
║                          ║
║   Port: ${PORT}           ║
║   Kanal: ${REQUIRED_CHANNEL}  ║
╚═══════════════════════════╝
    `);
});

// ======================== LAUNCH ========================
bot.launch().then(() => {
    console.log("✅ Bot ishlayapti!");
    console.log("🎤 Ovozli xabarlar tayyor!");
    console.log("📱 Avtomatik xabarlar faol!");
}).catch(err => {
    console.error("❌ Ishga tushmadi:", err);
    process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));