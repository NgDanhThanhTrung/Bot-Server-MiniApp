require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const User = require('./models/User');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Kết nối cơ sở dữ liệu MongoDB Cloud
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Bot-Server connected to MongoDB successfully.'))
  .catch(err => {
    console.error('MongoDB connection error in Bot-Server:', err);
    process.exit(1);
  });

const bot = new Telegraf(process.env.BOT_TOKEN);
app.use(express.json());

// Xử lý lệnh khởi tạo bot /start
bot.start(async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'Nông Dân Ảo';
    const startPayload = ctx.payload; // Nhận ref_telegramId từ link t.me/bot?start=ref_123456

    let referredBy = null;
    if (startPayload && startPayload.startsWith('ref_')) {
      const refIdStr = startPayload.replace('ref_', '');
      const refId = parseInt(refIdStr, 10);
      if (!isNaN(refId) && refId !== telegramId) {
        referredBy = refId;
      }
    }

    let user = await User.findOne({ telegramId });

    if (!user) {
      // Khởi tạo nông dân mới
      user = new User({
        telegramId,
        username,
        referredBy,
        miningStartedAt: null,
        isMining: false,
        lastActiveDay: new Date().toISOString().split('T')[0]
      });
      await user.save();
      
      await ctx.reply(`🎉 Chào mừng nông dân mới ${username} tham gia Nông Trại Khai Thác Ảo! 🌾\nMảnh đất của bạn đã sẵn sàng để canh tác.`);
    } else {
      await ctx.reply(`👋 Chào mừng trở lại nông trại, ${username}! Hãy chăm sóc khu mỏ và đừng để máy đào bị tắt.`);
    }

    // Hiển thị Inline Keyboard khởi tạo WebApp
    await ctx.reply('Bấm vào nút dưới đây để vào nông trại và vận hành máy đào của bạn ngay lập tức:', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🌾 Vào Nông Trại 🌾',
              web_app: { url: process.env.MINI_APP_URL }
            }
          ]
        ]
      }
    });

  } catch (error) {
    console.error('Lỗi khi xử lý lệnh /start:', error);
    ctx.reply('Hệ thống bận, vui lòng thử lại sau giây lát.');
  }
});

// Endpoint nhận Webhook từ Telegram API
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body, res);
});

// Endpoint tự phục vụ tự động ping Keep-Alive
app.get('/health', (req, res) => {
  res.status(200).send('Bot Server is live and healthy!');
});

app.listen(PORT, async () => {
  console.log(`Bot Server running on port ${PORT}`);
  try {
    // Đăng ký Webhook tự động với Telegram
    await bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/bot${process.env.BOT_TOKEN}`);
    console.log('Webhook registered successfully.');
  } catch (err) {
    console.error('Failed to set Webhook:', err);
  }
});

// Cơ chế Keep-Alive tránh Render Free Tier ngủ đông (Chạy mỗi 10 phút)
setInterval(() => {
  axios.get(`${process.env.WEBHOOK_URL}/health`)
    .then(() => console.log('[Keep-Alive] Bot Server pinged successfully.'))
    .catch(err => console.error('[Keep-Alive] Bot Server ping failed:', err.message));

  axios.get(`${process.env.MINI_APP_URL}/health`)
    .then(() => console.log('[Keep-Alive] Web Service pinged successfully.'))
    .catch(err => console.error('[Keep-Alive] Web Service ping failed:', err.message));
}, 10 * 60 * 1000);
