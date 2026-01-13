require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const express = require('express');

const {
  BOT_TOKEN,
  MISTRAL_API_KEY,
  OPENROUTER_API_KEY,
  RENDER_EXTERNAL_URL,
  PORT = 3000
} = process.env;

const REQUIRED_CHANNEL = '@studyneedfuture';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN mavjud emas');
  process.exit(1);
}

if (!MISTRAL_API_KEY && !OPENROUTER_API_KEY) {
  console.error('❌ MISTRAL_API_KEY yoki OPENROUTER_API_KEY kerak');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());

axios.defaults.timeout = 60000;

/* =========================
   UZUN JAVOBLarni QISMLARGA BO'LIB YUBORISH
========================= */
async function sendLongReply(ctx, text) {
  const chunkSize = 4000;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.reply(chunk); // Agar Markdown xato bersa, oddiy text
    }
  }
}

/* =========================
   XOTIRA
========================= */
const memory = {};
const userReminders = {};
const userLastActivity = {};

/* =========================
   VAQT VA SANA
========================= */
function getRealDateTime() {
  try {
    const now = new Date();
    const tashkentTime = new Date(now.getTime() + (5 * 60 * 60 * 1000));
    
    const year = tashkentTime.getUTCFullYear();
    const month = tashkentTime.getUTCMonth() + 1;
    const day = tashkentTime.getUTCDate();
    const hours = tashkentTime.getUTCHours();
    const minutes = tashkentTime.getUTCMinutes();
    
    const monthNames = [
      'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
      'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    
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
    console.error('Vaqt xatosi:', error);
    return {
      full: 'Vaqt ma\'lumoti mavjud emas',
      date: 'Sana ma\'lumoti mavjud emas',
      time: '00:00',
      weekday: 'Noma\'lum',
      timestamp: Date.now()
    };
  }
}

const SYSTEM_PROMPT = `Sen universal Mentor.AI yordamchisan - har qanday savolga javob berish,  turli tillarni orgatish , rasmlarni tahlil qilish, hujjatlarni o'qish va tahrirlash, kod yozish va boshqa ko'plab vazifalarni bajara olasan seni Black Rose ishlab chiqqan va sen mistral.ai modullari asosida ishlaysan .

ASOSIY QOIDALAR:
1. Foydalanuvchi bilan tabiiy va do'stona muloqot qil.
2. Foydalanuvchi qaysi tilda gaplashsa, shu tilda javob ber.
3. Har qanday savolga aniq va foydali javob ber.
4. Matematik masalalarni yech,  rasmlarni tahlil qilish .
4. sen umuman kod yozishni bilmaysan va bundek qilishing mumkin emas.
5. Hujjatlarni o'qi va kerak bo'lsa o'zgartir.
6. Faqat so'ralganda kompaniya, muallif yoki vaqt haqida ma'lumot ber.
7. Oddiy savollarga qisqa javob, murakkab savollarga batafsil javob ber.
8. Har doim yordam berishga tayyor bo'l.
9. faqat soralsagina gapir bolmasa jim tur.
10. doim qisqaa javob ber 2 yoki 3 gap bilan .

VAQT HAQIDA FAQAT SO'RALGANDA:
Hozirgi vaqt: {{CURRENT_DATETIME}}`;

/* =========================
   REMINDER
========================= */
const randomMessages = [
  "Salom! Ahvolingiz qanday? 😊",
  "Assalomu alaykum! Yordam kerakmi? 🚀",
  "Nima bilan band ekan? 🙂",
  "Biror savol bormi? 💬",
  "Gaplashamizmi? 📚"
];

function getRandomDelay() {
  const min = 2 * 60 * 60 * 1000;
  const max = 4 * 60 * 60 * 1000;
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
        if (Date.now() - (userLastActivity[chatId] || 0) < 90 * 60 * 1000) {
          scheduleReminder(chatId);
          return;
        }

        const msg = randomMessages[Math.floor(Math.random() * randomMessages.length)];
        
        await bot.telegram.sendMessage(chatId, msg, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "😊 Ha", callback_data: "reminder_reply" }],
              [{ text: "⏰ Keyinroq", callback_data: "reminder_later" }]
            ]
          }
        });
      } catch (err) {
        console.log('⚠️ Reminder xatosi:', err.message);
        delete userReminders[chatId];
        delete userLastActivity[chatId];
        return;
      }

      scheduleReminder(chatId);
    };

    userReminders[chatId] = setTimeout(sendReminder, delay);
  } catch (error) {
    console.error('Reminder xatosi:', error);
  }
}

bot.action('reminder_reply', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('Ajoyib! Nima yordam kerak? 😊');
    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Reminder reply xatosi:', error);
  }
});

bot.action('reminder_later', async (ctx) => {
  try {
    await ctx.answerCbQuery('Mayli 😊');
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
    `🔒 Botdan foydalanish uchun kanalga a'zo bo'ling`,
    {
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
      await ctx.editMessageText('✅ Rahmat! Botdan foydalanishingiz mumkin');
      resetUserActivity(ctx.chat.id);
    } else {
      await ctx.answerCbQuery('❌ Hali a\'zo emassiz', { show_alert: true });
    }
  } catch (error) {
    console.error('Check sub xatosi:', error);
  }
});

/* =========================
   AI API
========================= */
async function callAI(messages, retries = 3) {
  // 1. Mistral
  if (MISTRAL_API_KEY) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await axios.post(
          'https://api.mistral.ai/v1/chat/completions',
          {
            model: 'mistral-large-latest',
            messages,
            temperature: 0.7,
            max_tokens: 4000
          },
          { 
            headers: { 
              'Authorization': `Bearer ${MISTRAL_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 60000
          }
        );

        if (res.data?.choices?.[0]?.message?.content) {
          return { success: true, content: res.data.choices[0].message.content.trim(), provider: 'Mistral' };
        }
      } catch (error) {
        console.error(`Mistral urinish ${i + 1}: ${error.response?.data?.message || error.message}`);
        if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  // 2. OpenRouter (fallback)
  if (OPENROUTER_API_KEY) {
    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'google/gemini-1.5-flash',
          messages,
          max_tokens: 4000
        },
        { 
          headers: { 
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://t.me/your_bot',
            'X-Title': 'Mentor AI Bot'
          },
          timeout: 60000
        }
      );

      if (res.data?.choices?.[0]?.message?.content) {
        return { success: true, content: res.data.choices[0].message.content.trim(), provider: 'OpenRouter' };
      }
    } catch (error) {
      console.error('OpenRouter xato:', error.message);
    }
  }

  return { success: false, error: 'AI javob bermadi' };
}

/* =========================
   START
========================= */
bot.start(async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);

    await ctx.reply(
      `Salom ${ctx.from.first_name}! 👋\n\n` +
      `Men universal AI yordamchiman. Sizga qanday yordam bera olaman:\n\n` +
      `✅ Savolga javob berish\n` +
      `✅ Chet tillarini o'rganish \n` +
      `✅ Writing yozish IELTS tasklariga\n` +
      `✅ Rasm tahlil qilish\n` +
      `✅ Yozuv tekshirish va baholash\n` +
      `✅ PDF/DOCX o'qish va tahrirlash\n` +
      `✅ Rasm yaratish (/generate)\n\n` +
      `Savolingizni yozing yoki fayl yuboring! 🚀`
    );

    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Start xatosi:', error);
    ctx.reply('❌ Xatolik yuz berdi, qayta /start yuboring');
  }
});

/* =========================
   GENERATE
========================= */
bot.command('generate', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);

    const prompt = ctx.message.text.replace('/generate', '').trim();
    if (!prompt) return ctx.reply('Rasm uchun tavsif yozing:\n/generate chiroyli manzara');

    await ctx.reply('🎨 Rasm yaratilmoqda...');
    await ctx.sendChatAction('upload_photo');

    const res = await axios.post(
      'https://api.mistral.ai/v1/images/generations',
      {
        model: 'mistral-large-latest',
        prompt,
        n: 1
      },
      { 
        headers: { 
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 90000
      }
    );

    if (res.data?.data?.[0]?.url) {
      await ctx.replyWithPhoto(res.data.data[0].url, {
        caption: `✅ ${prompt}`
      });
      resetUserActivity(ctx.chat.id);
    } else {
      throw new Error('Rasm topilmadi');
    }
  } catch (e) {
    console.error('Rasm xatosi:', e.response?.data || e.message);
    ctx.reply('❌ Rasm yaratib bo\'lmadi. Keyinroq urinib ko\'ring.');
  }
});

/* =========================
   PHOTO
========================= */
bot.on('photo', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);

    await ctx.reply('🖼 Tahlil qilinyapti...');
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const dateTime = getRealDateTime();
    const systemWithTime = SYSTEM_PROMPT.replace('{{CURRENT_DATETIME}}', dateTime.full);

    const userPrompt = ctx.message.caption || 'Rasmni batafsil tahlil qil va nima ekanligini tushuntir. Agar bu yozuv, matematika, kod yoki boshqa narsani o\'z ichiga olsa, uni o\'qi va javob ber.';

    const res = await axios.post(
      'https://api.mistral.ai/v1/chat/completions',
      {
        model: 'pixtral-12b-2409',
        messages: [
          { role: 'system', content: systemWithTime },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: imageUrl }
            ]
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      },
      { 
        headers: { 
          'Authorization': `Bearer ${MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 90000
      }
    );

    const reply = res.data.choices[0].message.content;
    await sendLongReply(ctx, reply);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('Rasm tahlil xatosi:', e.response?.data || e.message);
    
    if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
      ctx.reply('❌ Rasm tahlili uzoq davom etdi. Kichikroq rasm yuboring.');
    } else {
      ctx.reply('❌ Rasm tahlil qilib bo\'lmadi. Qayta yuboring.');
    }
  }
});

/* =========================
   DOCUMENT
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
      return ctx.reply('❌ Faqat PDF yoki DOCX qo\'llab-quvvatlanadi');
    }

    if (!text || text.trim().length < 20) {
      return ctx.reply('⚠️ Faylda matn topilmadi');
    }

    const truncatedText = text.slice(0, 40000);
    if (text.length > 40000) {
      await ctx.reply('⚠️ Fayl juda uzun, faqat birinchi 40 000 belgisi tahlil qilinadi.');
    }

    const dateTime = getRealDateTime();
    const systemWithTime = SYSTEM_PROMPT.replace('{{CURRENT_DATETIME}}', dateTime.full);

    const userInstruction = ctx.message.caption || 'Hujjatni o\'qi va qisqacha tahlil qil. Agar o\'zgartirishlar kerak bo\'lsa, ayt.';

    const messages = [
      { role: 'system', content: systemWithTime },
      {
        role: 'user',
        content: `${userInstruction}\n\nHujjat matni:\n\n${truncatedText}`
      }
    ];

    const result = await callAI(messages);

    if (!result.success) {
      return ctx.reply('⚠️ AI xizmati javob bermayapti. Keyinroq urinib ko\'ring.');
    }

    console.log(`✅ Fayl tahlili: ${result.provider}`);
    await sendLongReply(ctx, result.content);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('Fayl xatosi:', e.response?.data || e.message);
    
    if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
      ctx.reply('❌ Fayl tahlili uzoq davom etdi. Qayta urinib ko\'ring.');
    } else {
      ctx.reply('❌ Faylni o\'qib bo\'lmadi');
    }
  }
});

/* =========================
   TEXT
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

    const result = await callAI(messages);

    if (!result.success) {
      return ctx.reply(
        '⚠️ AI xizmati hozirda javob bermayapti.\n\n' +
        '📝 Sabablari:\n' +
        '• Mistral API serveri band\n' +
        '• Tarmoq muammosi\n' +
        '• API key muddati tugagan\n\n' +
        '🔄 Bir necha daqiqadan keyin qayta urinib ko\'ring'
      );
    }

    const reply = result.content;
    console.log(`✅ Javob olindi: ${result.provider}`);

    memory[userId].push({ role: 'user', content: ctx.message.text });
    memory[userId].push({ role: 'assistant', content: reply });

    if (memory[userId].length > 20) {
      memory[userId] = memory[userId].slice(-20);
    }

    await sendLongReply(ctx, reply);
    resetUserActivity(ctx.chat.id);
  } catch (e) {
    console.error('Suhbat xatosi:', e.message);
    ctx.reply('⚠️ Xatolik yuz berdi. Qayta urinib ko\'ring.');
  }
});

/* =========================
   HELP
========================= */
bot.command('help', async (ctx) => {
  try {
    if (!(await checkSub(ctx))) return askSub(ctx);
    
    await ctx.reply(
      `📚 Yordam\n\n` +
      `Buyruqlar:\n` +
      `/start - Boshlash\n` +
      `/generate [tavsif] - Rasm yaratish\n` +
      `/help - Yordam\n\n` +
      `Imkoniyatlar:\n` +
      `✅ Har qanday savol\n` +
      `✅ Matematik masala yechish\n` +
      `✅ Kod yozish\n` +
      `✅ Rasm tahlili\n` +
      `✅ Yozuv tekshirish\n` +
      `✅ PDF/DOCX o'qish\n` +
      `✅ Tarjima\n\n` +
      `Savolingizni yozing! 🚀`
    );
    
    resetUserActivity(ctx.chat.id);
  } catch (error) {
    console.error('Help xatosi:', error);
    ctx.reply('❌ Xatolik');
  }
});

/* =========================
   XATOLARNI USHLASH
========================= */
bot.catch((err, ctx) => {
  console.error('Bot xatosi:', err);
  try {
    if (ctx && ctx.reply) {
      ctx.reply('❌ Xatolik. Qayta urinib ko\'ring.');
    }
  } catch (e) {
    console.error('Xabar yuborishda xato:', e);
  }
});

/* =========================
   SERVER
========================= */
app.get('/', (req, res) => {
  try {
    const dateTime = getRealDateTime();
    res.send(`
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h1>🚀 Bot ishlayapti!</h1>
          <p>📅 Vaqt: ${dateTime.full}</p>
          <p>✅ Faol</p>
        </body>
      </html>
    `);
  } catch (error) {
    res.send('Bot ishlayapti 🚀');
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
      const webhookUrl = `${RENDER_EXTERNAL_URL}${path}`;
      
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log('🔄 Eski webhook o\'chirildi');
      
      await bot.telegram.setWebhook(webhookUrl);
      console.log('🌍 Webhook o\'rnatildi:', webhookUrl);
      
      app.post(path, (req, res) => {
        bot.handleUpdate(req.body, res);
      });
      
      const webhookInfo = await bot.telegram.getWebhookInfo();
      console.log('📊 Webhook holati:', {
        url: webhookInfo.url,
        pending: webhookInfo.pending_update_count,
        lastError: webhookInfo.last_error_message || 'Xato yo\'q'
      });
      
      console.log('✅ Bot ishga tushdi (Webhook)');
    } else {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log('🔄 Webhook o\'chirildi');
      
      await bot.launch();
      console.log('🤖 Polling yoqildi');
      console.log('✅ Bot ishga tushdi (Polling)');
    }
  } catch (error) {
    console.error('❌ Bot xatosi:', error.message);
    if (error.response) {
      console.error('API javobi:', error.response.data);
    }
    process.exit(1);
  }
}

app.listen(PORT, () => {
  const dateTime = getRealDateTime();
  console.log(`📡 Server ${PORT} portda`);
  console.log(`🕐 Vaqt: ${dateTime.full}`);
  startBot();
});

process.once('SIGINT', () => {
  console.log('🛑 To\'xtatilmoqda...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 To\'xtatilmoqda...');
  bot.stop('SIGTERM');
});