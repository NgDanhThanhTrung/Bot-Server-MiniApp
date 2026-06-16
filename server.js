const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User'); 

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// ==========================================
// 1. CẤU HÌNH KINH TẾ (20,000 XU = 1 VNĐ)
// ==========================================
const EXCHANGE_RATE = 20000;    // Tỷ lệ quy đổi
const START_REWARD = 50000;     // Thưởng người mới
const REF_REWARD = 100000;      // Thưởng người mời
const USERS_PER_PAGE = 5;       // Số lượng người dùng hiển thị trên mỗi trang lệnh /list

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('✅ Bot Server đã kết nối Database Kinh Tế 2.0');
        // Tự động thiết lập cấu hình phân tách Menu Lệnh ngay khi kết nối DB thành công
        registerBotCommands();
    })
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

// Nút bấm MiniApp dùng chung tiện lợi
const miniAppButton = [Markup.button.webApp('🎮 MỞ MÁY ĐÀO XU', process.env.WEB_URL)];

// ==========================================
// TỰ ĐỘNG PHÂN TÁCH MENU LỆNH CHO USER & ADMIN
// ==========================================
async function registerBotCommands() {
    try {
        // 1. Menu mặc định dành cho TẤT CẢ NGƯỜI DÙNG (Ẩn hoàn toàn lệnh Admin)
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🚀 Khởi động máy đào & Xem số dư' },
            { command: 'myid', description: '🆔 Xem ID Telegram của bản thân' }
        ], { scope: { type: 'default' } });

        // 2. Menu đặc biệt chỉ hiển thị RIÊNG trong ô chat của ADMIN_ID
        if (process.env.ADMIN_ID) {
            await bot.telegram.setMyCommands([
                { command: 'start', description: '🚀 Khởi động máy đào & Xem số dư' },
                { command: 'myid', description: '🆔 Xem ID Telegram của bản thân' },
                // Các lệnh độc quyền hiển thị riêng cho Admin trên thanh Menu bấm nhanh
                { command: 'list', description: '🏆 [Admin] Xem danh sách toàn bộ người dùng' },
                { command: 'broadcast', description: '📢 [Admin] Gửi thông báo toàn hệ thống' },
                { command: 'addcoin', description: '💰 [Admin] Cộng Xu cho người dùng' },
                { command: 'adddiamond', description: '💎 [Admin] Cộng Kim cương cho người dùng' },
                { command: 'setlevel', description: '🆙 [Admin] Thay đổi Level người dùng' }
            ], { scope: { type: 'chat', chat_id: parseInt(process.env.ADMIN_ID) } });
            
            console.log('✅ Đã cấu hình phân tách Menu lệnh ẩn Admin thành công!');
        }
    } catch (error) {
        console.error('❌ Thất bại khi thiết lập Menu lệnh:', error);
    }
}

// ==========================================
// HÀM TIỆN ÍCH TRỢ GIÚP PHÂN TRANG CHO /LIST
// ==========================================
async function getUserListPage(page) {
    const totalUsers = await User.countDocuments();
    const totalPages = Math.ceil(totalUsers / USERS_PER_PAGE) || 1;

    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    // Truy vấn dữ liệu phân đoạn từ MongoDB
    const users = await User.find()
        .sort({ totalCoins: -1 })
        .skip((page - 1) * USERS_PER_PAGE)
        .limit(USERS_PER_PAGE);

    let text = `🏆 *DANH SÁCH TOÀN BỘ NGƯỜI DÙNG (Trang ${page}/${totalPages})*\n`;
    text += `👥 Tổng số thợ đào trên hệ thống: *${totalUsers}*\n\n`;

    const startIndex = (page - 1) * USERS_PER_PAGE;
    users.forEach((u, i) => {
        const usernameText = u.username !== 'n/a' ? `@${u.username}` : 'Không có';
        text += `${startIndex + i + 1}. *${u.name}*\n` +
                `   ├ 🆔 ID: \`${u.telegramId}\`\n` +
                `   ├ 👤 User: ${usernameText}\n` +
                `   ├ 💰 Số Xu: *${u.totalCoins.toLocaleString()} Xu*\n` +
                `   └ 💎 Kim cương: *${u.diamonds} 💎*\n\n`;
    });

    const buttons = [];
    const navRow = [];
    
    if (page > 1) {
        navRow.push(Markup.button.callback('◀️ Trang trước', `list_page_${page - 1}`));
    }
    if (page < totalPages) {
        navRow.push(Markup.button.callback('Trang sau ▶️', `list_page_${page + 1}`));
    }
    if (navRow.length > 0) buttons.push(navRow);

    // Kèm nút MiniApp
    buttons.push(miniAppButton);

    return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

// ==========================================
// 2. LOGIC XỬ LÝ LỆNH /START
// ==========================================
bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const startPayload = ctx.startPayload; 
    const today = new Date().toDateString();
    
    try {
        let user = await User.findOne({ telegramId: id.toString() });

        if (!user) {
            user = new User({
                telegramId: id.toString(),
                username: username || 'n/a',
                name: first_name,
                totalCoins: START_REWARD,
                diamonds: 0,
                level: 1,
                isMining: false,
                miningStartedAt: null,
                miningRate: 12.0, 
                adsWatchedToday: 0,
                lastActiveDay: today,
                refs: 0,
                referredBy: null
            });

            if (startPayload && startPayload !== id.toString()) {
                const inviter = await User.findOne({ telegramId: startPayload });
                if (inviter) {
                    inviter.totalCoins += REF_REWARD;
                    inviter.refs += 1;
                    await inviter.save();

                    user.referredBy = startPayload;

                    try {
                        await bot.telegram.sendMessage(inviter.telegramId, 
                            `🎉 *Mời bạn thành công!*\nBạn nhận được *+${REF_REWARD.toLocaleString()} Xu* vì đã mời ${first_name} tham gia!`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (e) { console.log("Không thể gửi tin báo cho người mời"); }
                }
            }
            await user.save();
        } else {
            user.name = first_name;
            user.username = username || 'n/a';
            
            if (user.lastActiveDay !== today) {
                user.adsWatchedToday = 0;
                user.lastActiveDay = today;
            }
            await user.save();
        }

        const vndValue = (user.totalCoins / EXCHANGE_RATE).toLocaleString('vi-VN');

        const welcomeMsg = `🚀 *CHÀO MỪNG ĐẾN VỚI MÁY ĐÀO XU 2.0*\n\n` +
                           `👤 Chủ nhân: *${first_name}*\n` +
                           `📊 Cấp độ: *Level ${user.level}*\n` +
                           `⚡ Tốc độ đào: *${user.miningRate} Xu/s*\n` +
                           `💰 Số dư: *${user.totalCoins.toLocaleString()} Xu*\n` +
                           `💸 Quy đổi: *~${vndValue} VNĐ*\n` +
                           `💎 Kim cương: *${user.diamonds}*\n\n` +
                           `👇 Bạn có thể chạm nhanh vào nút **Menu** ở góc trái để thao tác nhanh hơn!`;

        ctx.replyWithMarkdown(welcomeMsg, Markup.inlineKeyboard([miniAppButton]));

    } catch (e) {
        console.error("❌ Lỗi Start Bot:", e);
        ctx.reply("Hệ thống đang bận, vui lòng thử lại sau!");
    }
});

// ==========================================
// 3. TÍNH NĂNG: XEM ID BẢN THÂN (/myid) - CHO MỌI USER
// ==========================================
bot.command('myid', async (ctx) => {
    const { id, first_name } = ctx.from;
    ctx.replyWithMarkdown(`👤 Tài khoản: *${first_name}*\n🆔 ID Telegram của bạn là: \`${id}\`\n\n_(Chạm tay vào số ID ở trên để sao chép nhanh)_`);
});

// ==========================================
// 4. LỆNH ADMIN (BẢO MẬT TUYỆT ĐỐI)
// ==========================================

// Gửi thông báo toàn hệ thống
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) return ctx.reply("❌ Nhập nội dung: /broadcast [Nội dung]");

    const users = await User.find({});
    ctx.reply(`🚀 Đang gửi thông báo tới ${users.length} người dùng...`);

    let success = 0;
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 *THÔNG BÁO HỆ THỐNG*\n\n${msg}`, { parse_mode: 'Markdown' });
            success++;
            await new Promise(r => setTimeout(r, 50)); 
        } catch (e) { continue; }
    }
    ctx.reply(`✅ Đã gửi thành công tới ${success} người dùng.`);
});

// Lệnh Xem danh sách toàn bộ người dùng (Có phân trang thực tế)
bot.command('list', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    try {
        const { text, keyboard } = await getUserListPage(1); // Mặc định nạp trang 1
        await ctx.replyWithMarkdown(text, keyboard);
    } catch (e) { 
        console.error("Lỗi lấy dữ liệu /list:", e);
        ctx.reply("Lỗi lấy dữ liệu hệ thống."); 
    }
});

// Lắng nghe hành vi chuyển trang từ nút bấm Inline của Admin
bot.action(/^list_page_(\d+)$/, async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
        return ctx.answerCbQuery("❌ Bạn không có quyền truy cập dữ liệu quản trị!");
    }
    try {
        const targetPage = parseInt(ctx.match[1]);
        const { text, keyboard } = await getUserListPage(targetPage);

        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            ...keyboard
        });
        await ctx.answerCbQuery();
    } catch (e) {
        console.error("Lỗi cập nhật trang:", e);
        ctx.answerCbQuery("Không thể đổi trang.");
    }
});

// CỘNG XU CHO NGƯỜI DÙNG
bot.command('addcoin', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) return ctx.reply("❌ Sai cú pháp! Vui lòng nhập: /addcoin [telegramId] [số xu]");

    const targetId = args[0].trim();
    const amountCoins = parseInt(args[1]);

    if (isNaN(amountCoins)) return ctx.reply("❌ Số tiền cộng phải là một số hợp lệ!");

    try {
        const user = await User.findOne({ telegramId: targetId });
        if (!user) return ctx.reply("❌ Không tìm thấy người dùng này trong hệ thống.");

        user.totalCoins += amountCoins;
        await user.save();

        ctx.reply(`✅ Đã cộng *+${amountCoins.toLocaleString()} Xu* cho người dùng *${user.name}* (ID: ${targetId}).\n💰 Số dư mới: *${user.totalCoins.toLocaleString()} Xu*`, { parse_mode: 'Markdown' });
        
        try {
            await bot.telegram.sendMessage(targetId, `🎁 Bạn vừa được Admin tặng *+${amountCoins.toLocaleString()} Xu* vào tài khoản!`, { parse_mode: 'Markdown' });
        } catch (err) { console.log(`Không thể gửi tin nhắn thông báo cho tài khoản ${targetId}`); }

    } catch (e) {
        ctx.reply("❌ Có lỗi xảy ra khi thực hiện lệnh.");
    }
});

// CỘNG KIM CƯƠNG CHO NGƯỜI DÙNG
bot.command('adddiamond', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) return ctx.reply("❌ Sai cú pháp! Vui lòng nhập: /adddiamond [telegramId] [số kim cương]");

    const targetId = args[0].trim();
    const amountDiamonds = parseInt(args[1]);

    if (isNaN(amountDiamonds)) return ctx.reply("❌ Số kim cương cộng phải là một số hợp lệ!");

    try {
        const user = await User.findOne({ telegramId: targetId });
        if (!user) return ctx.reply("❌ Không tìm thấy người dùng này trong hệ thống.");

        user.diamonds += amountDiamonds;
        await user.save();

        ctx.reply(`✅ Đã cộng *+${amountDiamonds.toLocaleString()} 💎* cho người dùng *${user.name}* (ID: ${targetId}).\n💎 Số dư mới: *${user.diamonds} Kim cương*`, { parse_mode: 'Markdown' });
        
        try {
            await bot.telegram.sendMessage(targetId, `🎁 Bạn vừa được Admin tặng *+${amountDiamonds.toLocaleString()} 💎* vào tài khoản!`, { parse_mode: 'Markdown' });
        } catch (err) { console.log(`Không thể gửi tin nhắn thông báo cho tài khoản ${targetId}`); }

    } catch (e) {
        ctx.reply("❌ Có lỗi xảy ra khi thực hiện lệnh.");
    }
});

// THAY ĐỔI LEVEL CHO NGƯỜI DÙNG (TỰ ĐỘNG CẬP NHẬT TỐC ĐỘ ĐÀO)
bot.command('setlevel', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) return ctx.reply("❌ Sai cú pháp! Vui lòng nhập: /setlevel [telegramId] [Level]");

    const targetId = args[0].trim();
    const newLevel = parseInt(args[1]);

    if (isNaN(newLevel) || newLevel < 1) return ctx.reply("❌ Cấp độ phải là số nguyên lớn hơn hoặc bằng 1!");

    try {
        const user = await User.findOne({ telegramId: targetId });
        if (!user) return ctx.reply("❌ Không tìm thấy người dùng này trong hệ thống.");

        const RATE_INCREASE_PER_LEVEL = 0.2;
        const baseRate = 12.0;
        const newMiningRate = baseRate + (newLevel - 1) * baseRate * RATE_INCREASE_PER_LEVEL;

        user.level = newLevel;
        user.miningRate = parseFloat(newMiningRate.toFixed(1)); 
        await user.save();

        ctx.reply(`✅ Đã điều chỉnh tài khoản *${user.name}* lên *Level ${newLevel}*.\n⚡ Tốc độ khai thác mới: *${user.miningRate} Xu/s*`, { parse_mode: 'Markdown' });

        try {
            await bot.telegram.sendMessage(targetId, `🆙 Tài khoản của bạn đã được thay đổi lên *Level ${newLevel}* bởi Admin!\n⚡ Tốc độ đào mới: *${user.miningRate} Xu/s*`, { parse_mode: 'Markdown' });
        } catch (err) { console.log(`Không thể gửi tin nhắn thông báo cho tài khoản ${targetId}`); }

    } catch (e) {
        ctx.reply("❌ Có lỗi xảy ra khi thực hiện lệnh.");
    }
});

// ==========================================
// 5. CẤU HÌNH WEB SERVER & WEBHOOK
// ==========================================
app.use(express.json());
app.use(bot.webhookCallback('/api/tg-webhook'));

app.get('/', (req, res) => res.send('Bot Mining 2.0 (Rate 20,000:1) is Active'));

app.get('/health', (req, res) => {
    res.json({ status: 'running', db: mongoose.connection.readyState === 1 ? 'ok' : 'error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Server] Đang chạy trên cổng ${PORT}`);
});
