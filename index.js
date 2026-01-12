require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const express = require('express');

const {
  BOT_TOKEN,
  MISTRAL_API_KEY,
  RENDER_EXTERNAL_URL,
  PORT = 3000
} = process.env;

const REQUIRED_CHANNEL = '@studyneedfuture';

if (!BOT_TOKEN || !MISTRAL_API_KEY) {
  console.error('❌ ENV xatolik: BOT_TOKEN yoki MISTRAL_API_KEY mavjud emas');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

/* =========================
   XOTIRA (RAM MEMORY)
========================= */
const memory = {}; // userId -> messages[]

const SYSTEM_PROMPT = `
Sen Mentor.ai — Black Rose kompaniyasi yaratgan aqlli AI yordamchisan. Bu platformani Akobir Norqulov Baxtiyarovich ishlab chiqqan va sen mistral.ai modullaridan foydalanasan. 🌹
Muallif: Akobir Norqulov.
Black Rose — O'zbekistondagi ilk sun'iy intellektlar bilan ishlaydigan va O'zbekiston bozorini ta'limdan tortib xizmat ko'rsatishgacha raqamlashtirishni maqsad qilgan korporatsiya.

1. Foydalanuvchi bilan do‘stona va insondek muloqot qil.
2. Foydalanuvchi qaysi tilda gaplashsa, shu tilda javob ber.
3. Javoblar qisqa, aniq va foydali bo‘lsin.
4. Murakkab gaplardan qoch, sodda tilda tushuntir.
5. Kerakli joyda emoji ishlat 🙂🚀
6. Katta harflarni ko‘p ishlatma.
7. O‘zingni haqiqiy mentor kabi tut: yordamchi, xotirjam va ishonchli.
8. Oddiy savollarga qisqa (1-5 gap) javob ber.
9. Faqat "batafsilroq tushuntir" yoki shunga o'xshash so'rov bo'lsa, kengroq javob va misollar bilan tushuntir.
`;

/* =========================
   REMINDER XABARLAR — HAR 1-3 SOAT ORALIG‘IDA RANDOM
========================= */
const randomMessages = [
  "Salom! Ahvolingiz qanday? 😊",
  "Nima qilyapsiz hozir? Biror yangilik bormi? 🚀",
  "Tinchlikmi? Hammasi joyidami? 🙂",
  "Kayfiyatingiz qanday bugun?",
  "Yana salom! Suhbatlashamizmi? 📩",
  "Uzoq vaqtdan beri yozmadingiz-ku, ahvolingiz yaxshimi?",
  "Ishlaringiz qalay? Yordam kerakmi biror narsada? 🤝",
  "Salom do'st! Meni unutib qo'ymadingizmi? 😅",
  "Bugun nima bilan band bo'ldingiz?",
  "Ahvolingiz qanday? Bir xabar berib qo'ying 😊"
];

const userReminders = {}; // chatId -> timeoutId
const userLastActivity = {}; // chatId -> timestamp (oxirgi faollik vaqti)

function getRandomDelay() {
  const min = 1 * 60 * 60 * 1000; // 1 soat
  const max = 3 * 60 * 60 * 1000; // 3 soat
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleReminder(chatId) {
  if (userReminders[chatId]) {
    clearTimeout(userReminders[chatId]);
  }

  const delay = getRandomDelay();
  userLastActivity[chatId] = Date.now(); // faollikni yangilash

  const sendReminder = async () => {
    // Oxirgi faollikdan beri 1 soat o'tganligini tekshirish (spam bo'lmasligi uchun)
    if (Date.now() - (userLastActivity[chatId] || 0) < 60 * 60 * 1000) {
      // Agar user yaqinda faol bo'lgan bo'lsa, keyingisini schedule qil
      scheduleReminder(chatId);
      return;
    }

    const msg = randomMessages[Math.floor(Math.random() * randomMessages.length)];
    
    try {
      await bot.telegram.sendMessage(chatId, msg, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🙂 Yaxshiman, suhbatlashamiz!", callback_data: "reminder_reply" }]
          ]
        }
      });
    } catch (err) {
      console.log('Reminder yuborish xatosi (user block qilgan bo‘lishi mumkin):', err.message);
      delete userReminders[chatId];
      delete userLastActivity[chatId];
      return;
    }

    // Keyingi reminder ni rejalashtir
    scheduleReminder(chatId);
  };

  userReminders[chatId] = setTimeout(sendReminder, delay);
}

// Reminder buttoniga javob
bot.action('reminder_reply', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("Ajoyib! 😊 Nima haqida gaplashamiz? Savol bering yoki biror narsa so'rang 🚀");
  scheduleReminder(ctx.chat.id); // faollik yangilandi
});

/* =========================
   HAR QANDAY FAOLLIKDA REMINDER RESET
========================= */
function resetUserActivity(chatId) {
  userLastActivity[chatId] = Date.now();
  scheduleReminder(chatId);
}

/* =========================
   KANAL TEKSHIRUV
========================= */
async function checkSub(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

function askSub(ctx) {
  return ctx.reply(
    `🔒 <b>Botdan foydalanish uchun kanalga a'zo bo'ling</b>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('📢 Kanalga oʻtish', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
        [Markup.button.callback('✅ Tekshirish', 'check_sub')]
      ])
    }
  );
}

bot.action('check_sub', async (ctx) => {
  if (await checkSub(ctx)) {
    await ctx.editMessageText('✅ Rahmat! Endi botdan foydalanishingiz mumkin 🙂');
    resetUserActivity(ctx.chat.id);
  } else {
    await ctx.answerCbQuery('❌ Hali a\'zo emassiz', { show_alert: true });
  }
});

/* =========================
   START
========================= */
bot.start(async (ctx) => {
  if (!(await checkSub(ctx))) return askSub(ctx);

  await ctx.replyWithHTML(
    `<b>Assalomu alaykum, ${ctx.from.first_name}!</b> 👋

<b>Mentor.AI</b> ga xush kelibsiz!

Savol bering, fayl yuboring, rasm so'rang yoki rasm tahlil qiling. 
O'qish, ish, til o'rganish va boshqa sohalarda qo'limdan kelgancha yordam beramiz 🚀`
  );

  resetUserActivity(ctx.chat.id);
});

/* =========================
   RASM GENERATSIYA
========================= */
bot.command('generate', async (ctx) => {
  if (!(await checkSub(ctx))) return askSub(ctx);

  const prompt = ctx.message.text.replace('/generate', '').trim();
  if (!prompt) return ctx.reply('✍️ Rasm uchun tavsif yozing');

  try {
    await ctx.reply('🎨 Rasm yaratilmoqda...');
    await ctx.sendChatAction('upload_photo');

    const res = await axios.post(
      'https://api.mistral.ai/v1/images/generations',
      {
        model: 'Mistral Large 3',
        prompt,
        n: 1
      },
      { headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` } }
    );

    await ctx.replyWithPhoto(res.data.data[0].url, {
      caption: `✅ ${prompt}`
    });

    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('Rasm generatsiya xatosi:', e.response?.data || e.message);
    ctx.reply('❌ Rasm yaratib bo\'lmadi');
  }
});

/* =========================
   RASM TAHLILI (VISION)
========================= */
bot.on('photo', async (ctx) => {
  if (!(await checkSub(ctx))) return askSub(ctx);

  try {
    await ctx.reply('🖼 Rasm tahlil qilinyapti...');
    const photo = ctx.message.photo.at(-1);
    const file = await ctx.telegram.getFile(photo.file_id);

    const imageUrl =
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const mistralChat = async (messages, model = 'pixtral-12b-2409') => {
      const res = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        { model, messages },
        { headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` } }
      );
      return res.data.choices[0].message.content;
    };

    const result = await mistralChat([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Rasmni aniq va qisqa tahlil qil' },
          { type: 'image_url', image_url: imageUrl }
        ]
      }
    ], 'pixtral-12b-2409');

    await ctx.reply(result);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error(e.message);
    ctx.reply('❌ Rasm tahlil bo‘lmadi');
  }
});

/* =========================
   FAYL TAHLILI
========================= */
bot.on('document', async (ctx) => {
  if (!(await checkSub(ctx))) return askSub(ctx);

  try {
    await ctx.reply('📄 Fayl o\'qilmoqda...');
    await ctx.sendChatAction('typing');

    const doc = ctx.message.document;
    const file = await ctx.telegram.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const fileRes = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
      timeout: 30000
    });

    let text = '';

    if (doc.mime_type === 'application/pdf') {
      const parsed = await pdfParse(fileRes.data);
      text = parsed.text;
    } else if (doc.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer: fileRes.data });
      text = result.value;
    } else {
      return ctx.reply('❌ Faqat PDF yoki DOCX fayllarni qo‘llab-quvvatlayman');
    }

    if (!text || text.trim().length < 30) {
      return ctx.reply(
        '⚠️ Faylda o‘qiladigan matn topilmadi.\n\n' +
        '📌 Agar bu skanerlangan PDF bo‘lsa, OCR kerak bo‘lishi mumkin.'
      );
    }

    const aiRes = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Quyidagi hujjat matnini qisqacha va foydali tahlil qil:\n\n${text.slice(0, 30000)}`
          }
        ]
      },
      { headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` } }
    );

    await ctx.reply(aiRes.data.choices[0].message.content);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('FILE ERROR:', e.response?.data || e.message);
    ctx.reply('❌ Faylni tahlil qilib bo‘lmadi');
  }
});

/* =========================
   MATNLI SUHBAT + XOTIRA
========================= */
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  if (!(await checkSub(ctx))) return askSub(ctx);

  const userId = ctx.from.id;
  memory[userId] ??= [];

  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...memory[userId].slice(-10),
      { role: 'user', content: ctx.message.text }
    ];

    await ctx.sendChatAction('typing');

    const res = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-large-latest',
        messages,
        temperature: 0.7
      },
      { headers: { Authorization: `Bearer ${MISTRAL_API_KEY}` } }
    );

    const reply = res.data.choices[0].message.content;

    memory[userId].push({ role: 'user', content: ctx.message.text });
    memory[userId].push({ role: 'assistant', content: reply });

    await ctx.reply(reply);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('AI suhbat xatosi:', e.response?.data || e.message);
    ctx.reply('⚠️ Xatolik yuz berdi, qayta urinib ko‘ring');
  }
});

/* =========================
   WEBHOOK / POLLING
========================= */
app.get('/', (_, res) => res.send('Mentor.ai ishlayapti 🚀'));

async function startBot() {
  if (RENDER_EXTERNAL_URL) {
    const path = `/bot${BOT_TOKEN}`;
    await bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${path}`);
    app.post(path, (req, res) => bot.handleUpdate(req.body, res));
    console.log('🌍 Webhook yoqildi');
  } else {
    bot.launch();
    console.log('🤖 Polling rejimi');
  }
}

app.listen(PORT, () => {
  console.log(`📡 Server ${PORT} portda ishlayapti`);
  startBot();
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));