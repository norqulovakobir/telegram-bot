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

/* =========================
   REAL VAQT VA SANA
========================= */
function getRealDateTime() {
  try {
    const now = new Date();
    
    // Toshkent vaqti uchun +5 soat qo'shamiz
    const tashkentTime = new Date(now.getTime() + (5 * 60 * 60 * 1000));
    
    const year = tashkentTime.getUTCFullYear();
    const month = tashkentTime.getUTCMonth() + 1;
    const day = tashkentTime.getUTCDate();
    const hours = tashkentTime.getUTCHours();
    const minutes = tashkentTime.getUTCMinutes();
    
    // Oy nomlari
    const monthNames = [
      'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
      'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    
    // Hafta kunlari
    const dayNames = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
    const weekday = dayNames[tashkentTime.getUTCDay()];
    
    return {
      full: `${weekday}, ${day} ${monthNames[month - 1]} ${year}-yil, soat ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      date: `${day} ${monthNames[month - 1]} ${year}`,
      time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      weekday: weekday,
      timestamp: tashkentTime.getTime()
    };
  } catch (error) {
    console.error('Vaqt olishda xatolik:', error);
    return {
      full: 'Vaqt ma\'lumoti mavjud emas',
      date: 'Sana ma\'lumoti mavjud emas',
      time: '00:00',
      weekday: 'Noma\'lum',
      timestamp: Date.now()
    };
  }
}

const SYSTEM_PROMPT = `Sen Mentor.ai — Black Rose kompaniyasi yaratgan aqlli AI yordamchisan. Bu platformani Akobir Norqulov Baxtiyarovich ishlab chiqqan va sen mistral.ai modullaridan foydalanasan. 🌹
Muallif: Akobir Norqulov.
Black Rose — O'zbekistondagi ilk sun'iy intellektlar bilan ishlaydigan va O'zbekiston bozorini ta'limdan tortib xizmat ko'rsatishgacha raqamlashtirishni maqsad qilgan korporatsiya.

MUHIM QOIDALAR:
1. Foydalanuvchi bilan do'stona va insondek muloqot qil.
2. Foydalanuvchi qaysi tilda gaplashsa, shu tilda javob ber.
3. Javoblar qisqa, aniq va foydali bo'lsin.
4. Murakkab gaplardan qoch, sodda tilda tushuntir.
5. Kerakli joyda emoji ishlat 🙂🚀
6. Katta harflarni ko'p ishlatma.
7. O'zingni haqiqiy mentor kabi tut: yordamchi, xotirjam va ishonchli.
8. Oddiy savollarga qisqa (1-5 gap) javob ber.
9. Faqat "batafsilroq tushuntir" yoki shunga o'xshash so'rov bo'lsa, kengroq javob va misollar bilan tushuntir.

VAQT VA SANA (Toshkent vaqti, UTC+5):
- Hozirgi REAL vaqt va sana: {{CURRENT_DATETIME}}
- Agar foydalanuvchi "bugun necha", "soat necha", "qaysi kun" deb so'rasa, yuqoridagi real ma'lumotni ishlatgin.
- Har doim aniq va to'g'ri sana/vaqt ma'lumotini ber.`;

/* =========================
   REMINDER XABARLAR
========================= */
const randomMessages = [
  "Salom! Ahvolingiz qanday? Nima bilan bandmisiz? 😊",
  "Assalomu alaykum! Uzoq vaqt yozmadingiz-ku, ishlaringiz yaxshimi? 🚀",
  "Tinchlikmi? Biror yordam kerakmi? 🙂",
  "Bugun kayfiyatingiz qalay? Gaplashamizmi? 💬",
  "Yana salom! Biror savol yoki qiziqish bormi? 📚",
  "Nima qilyapsiz hozir? Yordam beray deb o'yladim 😊",
  "Salom do'stim! Meni unutib qo'ymadingizmi? 😅",
  "Ishlaringiz qalaydir? Gaplashamizmi? 🤝",
  "Bir necha soatdan beri yozmayapsiz, hammasi joyidami? 🌟",
  "Salom! Bugun nima rejalaringiz bor? 📝",
  "Qanday ahvol? Biror yangilik bormi? 🗞",
  "Assalomu alaykum! Kayfiyat qanday bugun? ☀️",
  "Nima gap? Suhbatlashamizmi? 💭",
  "Salom! Biror narsada yordam kerakmi sizga? 🎯",
  "Tinch-tartiblikmi hamma narsa? Xabar berib qo'ying 😊"
];

const userReminders = {};
const userLastActivity = {};

function getRandomDelay() {
  const min = 1 * 60 * 60 * 1000; // 1 soat
  const max = 3 * 60 * 60 * 1000; // 3 soat
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scheduleReminder(chatId) {
  try {
    if (userReminders[chatId]) {
      clearTimeout(userReminders[chatId]);
    }

    const delay = getRandomDelay();
    userLastActivity[chatId] = Date.now();

    const sendReminder = async () => {
      try {
        // Oxirgi faollikdan beri 50 daqiqa o'tganligini tekshirish
        if (Date.now() - (userLastActivity[chatId] || 0) < 50 * 60 * 1000) {
          scheduleReminder(chatId);
          return;
        }

        const msg = randomMessages[Math.floor(Math.random() * randomMessages.length)];
        
        await bot.telegram.sendMessage(chatId, msg, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "😊 Gaplashamiz!", callback_data: "reminder_reply" }],
              [{ text: "⏰ Keyinroq", callback_data: "reminder_later" }]
            ]
          }
        });
      } catch (err) {
        console.log('⚠️ Reminder yuborish xatosi:', err.message);
        delete userReminders[chatId];
        delete userLastActivity[chatId];
        return;
      }

      scheduleReminder(chatId);
    };

    userReminders[chatId] = setTimeout(sendReminder, delay);
  } catch (error) {
    console.error('Reminder rejalashtirish xatosi:', error);
  }
}

bot.action('reminder_reply', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const dateTime = getRealDateTime();
    await ctx.reply(
      `Ajoyib! 😊 Hozir ${dateTime.time}. Nima haqida gaplashamiz? Savol bering yoki biror narsa so'rang 🚀`
    );
    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Reminder reply xatosi:', error);
  }
});

bot.action('reminder_later', async (ctx) => {
  try {
    await ctx.answerCbQuery('Mayli, keyinroq gaplashamiz 😊');
    await ctx.deleteMessage();
    scheduleReminder(ctx.chat.id);
  } catch (error) {
    console.error('Reminder later xatosi:', error);
  }
});

function resetUserActivity(chatId) {
  try {
    userLastActivity[chatId] = Date.now();
    scheduleReminder(chatId);
  } catch (error) {
    console.error('Reset activity xatosi:', error);
  }
}

/* =========================
   KANAL TEKSHIRUV
========================= */
async function checkSub(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (error) {
    console.log('Kanal tekshiruv xatosi:', error.message);
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
  try {
    if (await checkSub(ctx)) {
      await ctx.editMessageText('✅ Rahmat! Endi botdan foydalanishingiz mumkin 🙂');
      resetUserActivity(ctx.chat.id);
    } else {
      await ctx.answerCbQuery('❌ Hali a\'zo emassiz', { show_alert: true });
    }
  } catch (error) {
    console.error('Check sub action xatosi:', error);
  }
});

/* =========================
   START
========================= */
bot.start(async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);

    const dateTime = getRealDateTime();
    
    await ctx.replyWithHTML(
      `<b>Assalomu alaykum, ${ctx.from.first_name}!</b> 👋

<b>Mentor.AI</b> ga xush kelibsiz!

📅 Bugun: ${dateTime.full}

Savol bering, fayl yuboring, rasm so'rang yoki rasm tahlil qiling. 
O'qish, ish, til o'rganish va boshqa sohalarda yordam beramiz 🚀`
    );

    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Start xatosi:', error);
    ctx.reply('❌ Xatolik yuz berdi, qayta /start buyrug\'ini yuboring');
  }
});

/* =========================
   VAQT VA SANA BUYRUQLARI
========================= */
bot.command('vaqt', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);
    
    const dateTime = getRealDateTime();
    await ctx.reply(
      `🕐 Hozirgi vaqt: ${dateTime.time}\n` +
      `📅 Bugun: ${dateTime.full}`
    );
    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Vaqt buyruq xatosi:', error);
    ctx.reply('❌ Vaqt ma\'lumotini olishda xatolik');
  }
});

bot.command('sana', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);
    
    const dateTime = getRealDateTime();
    await ctx.reply(
      `📅 Bugungi sana:\n${dateTime.full}`
    );
    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Sana buyruq xatosi:', error);
    ctx.reply('❌ Sana ma\'lumotini olishda xatolik');
  }
});

/* =========================
   RASM GENERATSIYA
========================= */
bot.command('generate', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);

    const prompt = ctx.message.text.replace('/generate', '').trim();
    if (!prompt) return ctx.reply('✍️ Rasm uchun tavsif yozing. Misol:\n/generate chiroyli tog\'lar manzarasi');

    await ctx.reply('🎨 Rasm yaratilmoqda, biroz kuting...');
    await ctx.sendChatAction('upload_photo');

    const res = await axios.post(
      'https://api.mistral.ai/v1/images/generations',
      {
        model: 'pixtral-12b-2409',
        prompt,
        n: 1
      },
      { 
        headers: { 
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    if (res.data && res.data.data && res.data.data[0] && res.data.data[0].url) {
      await ctx.replyWithPhoto(res.data.data[0].url, {
        caption: `✅ ${prompt}`
      });
      resetUserActivity(ctx.chat.id);
    } else {
      throw new Error('Rasm URL topilmadi');
    }
  } catch (e) {
    console.error('Rasm generatsiya xatosi:', e.response?.data || e.message);
    ctx.reply('❌ Rasm yaratib bo\'lmadi. Keyinroq qayta urinib ko\'ring.');
  }
});

/* =========================
   RASM TAHLILI (VISION)
========================= */
bot.on('photo', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);

    await ctx.reply('🖼 Rasm tahlil qilinyapti...');
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const dateTime = getRealDateTime();
    const systemWithTime = SYSTEM_PROMPT.replace('{{CURRENT_DATETIME}}', dateTime.full);

    const caption = ctx.message.caption || 'Rasmni aniq va qisqa tahlil qil';

    const res = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'pixtral-12b-2409',
        messages: [
          { role: 'system', content: systemWithTime },
          {
            role: 'user',
            content: [
              { type: 'text', text: caption },
              { type: 'image_url', image_url: imageUrl }
            ]
          }
        ]
      },
      { 
        headers: { 
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const reply = res.data.choices[0].message.content;
    await ctx.reply(reply);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('Rasm tahlil xatosi:', e.response?.data || e.message);
    ctx.reply('❌ Rasm tahlil qilib bo\'lmadi. Qayta urinib ko\'ring.');
  }
});

/* =========================
   FAYL TAHLILI
========================= */
bot.on('document', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);

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
      return ctx.reply('❌ Faqat PDF yoki DOCX fayllarni qo\'llab-quvvatlayman');
    }

    if (!text || text.trim().length < 30) {
      return ctx.reply(
        '⚠️ Faylda o\'qiladigan matn topilmadi.\n\n' +
        '📌 Agar bu skanerlangan PDF bo\'lsa, OCR kerak bo\'lishi mumkin.'
      );
    }

    const dateTime = getRealDateTime();
    const systemWithTime = SYSTEM_PROMPT.replace('{{CURRENT_DATETIME}}', dateTime.full);

    const aiRes = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: systemWithTime },
          {
            role: 'user',
            content: `Quyidagi hujjat matnini qisqacha va foydali tahlil qil:\n\n${text.slice(0, 30000)}`
          }
        ]
      },
      { 
        headers: { 
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const reply = aiRes.data.choices[0].message.content;
    await ctx.reply(reply);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('FILE ERROR:', e.response?.data || e.message);
    ctx.reply('❌ Faylni tahlil qilib bo\'lmadi');
  }
});

/* =========================
   MATNLI SUHBAT + XOTIRA
========================= */
bot.on('text', async (ctx) => {
  try {
    if (ctx.message.text.startsWith('/')) return;
    if (!(await checkSub(ctx))) return askSub(ctx);

    const userId = ctx.from.id;
    if (!memory[userId]) {
      memory[userId] = [];
    }

    const dateTime = getRealDateTime();
    const systemWithTime = SYSTEM_PROMPT.replace('{{CURRENT_DATETIME}}', dateTime.full);

    const messages = [
      { role: 'system', content: systemWithTime },
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
      { 
        headers: { 
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    const reply = res.data.choices[0].message.content;

    memory[userId].push({ role: 'user', content: ctx.message.text });
    memory[userId].push({ role: 'assistant', content: reply });

    // Xotirani cheklash (oxirgi 20 ta xabar)
    if (memory[userId].length > 20) {
      memory[userId] = memory[userId].slice(-20);
    }

    await ctx.reply(reply);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('AI suhbat xatosi:', e.response?.data || e.message);
    ctx.reply('⚠️ Xatolik yuz berdi, qayta urinib ko\'ring');
  }
});

/* =========================
   YORDAM
========================= */
bot.command('help', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);
    
    const dateTime = getRealDateTime();
    
    await ctx.replyWithHTML(
      `<b>📚 Mentor.AI Yordam</b>

<b>Buyruqlar:</b>
/start - Botni boshlash
/vaqt - Hozirgi vaqtni ko'rish
/sana - Bugungi sanani ko'rish
/generate [tavsif] - Rasm yaratish
/help - Yordam

<b>Imkoniyatlar:</b>
✅ Matnli suhbat va savollar
✅ PDF/DOCX tahlil (fayl yuboring)
✅ Rasm tahlili (rasm yuboring)
✅ Rasm generatsiya
✅ Xotira (10 ta oxirgi xabar)

📅 Hozirgi vaqt: ${dateTime.full}

Savol bering va yordam olishni boshlang! 🚀`
    );
    
    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Help xatosi:', error);
    ctx.reply('❌ Yordam ma\'lumotini olishda xatolik');
  }
});

/* =========================
   XATOLARNI USHLASH
========================= */
bot.catch((err, ctx) => {
  console.error('Bot xatosi:', err);
  try {
    ctx.reply('❌ Xatolik yuz berdi. Qayta urinib ko\'ring.');
  } catch (e) {
    console.error('Xatolik xabarini yuborishda muammo:', e);
  }
});

/* =========================
   WEBHOOK / POLLING
========================= */
app.get('/', (req, res) => {
  try {
    const dateTime = getRealDateTime();
    res.send(`
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h1>🚀 Mentor.AI ishlayapti!</h1>
          <p>📅 Server vaqti: ${dateTime.full}</p>
          <p>✅ Bot faol</p>
        </body>
      </html>
    `);
  } catch (error) {
    res.send('Mentor.AI ishlayapti 🚀');
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    time: getRealDateTime().full,
    uptime: process.uptime()
  });
});

async function startBot() {
  try {
    if (RENDER_EXTERNAL_URL) {
      const path = `/bot${BOT_TOKEN}`;
      await bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${path}`);
      app.post(path, (req, res) => {
        bot.handleUpdate(req.body, res);
      });
      console.log('🌍 Webhook yoqildi:', RENDER_EXTERNAL_URL + path);
    } else {
      await bot.launch();
      console.log('🤖 Polling rejimi yoqildi');
    }
    console.log('✅ Bot muvaffaqiyatli ishga tushdi!');
  } catch (error) {
    console.error('❌ Bot ishga tushirishda xatolik:', error);
    process.exit(1);
  }
}

app.listen(PORT, () => {
  const dateTime = getRealDateTime();
  console.log(`📡 Server ${PORT} portda ishlayapti`);
  console.log(`🕐 Server vaqti: ${dateTime.full}`);
  startBot();
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Bot to\'xtatilmoqda...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 Bot to\'xtatilmoqda...');
  bot.stop('SIGTERM');
});