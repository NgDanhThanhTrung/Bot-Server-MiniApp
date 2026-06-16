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
        // 1. Menu mặc định dành cho TẤT CẢ NGƯỜI DÙNG (Bổ sung tính năng mới)
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🚀 Khởi động máy đào & Xem số dư' },
            { command: 'checkin', description: '🎁 Điểm danh hàng ngày nhận Xu' },
            { command: 'luckywheel', description: '🎰 Vòng quay may mắn bằng Kim cương' },
            { command: 'myid', description: '🆔 Xem ID Telegram của bản thân' }
        ], { scope: { type: 'default' } });

        // 2. Menu đặc biệt chỉ hiển thị RIÊNG trong ô chat của ADMIN_ID
        if (process.env.ADMIN_ID) {
            await bot.telegram.setMyCommands([
                { command: 'start', description: '🚀 Khởi động máy đào & Xem số dư' },
                { command: 'checkin', description: '🎁 Điểm danh hàng ngày nhận Xu' },
                { command: 'luckywheel', description: '🎰 Vòng quay may mắn bằng Kim cương' },
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
                `    ├ 🆔 ID: \`${u.telegramId}\`\n` +
                `    ├ 👤 User: ${usernameText}\n` +
                `    ├ 💰 Số Xu: *${u.totalCoins.toLocaleString()} Xu*\n` +
                `    └ 💎 Kim cương: *${u.diamonds} 💎*\n\n`;
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
// TÍNH NĂNG MỚI: ĐIỂM DANH HÀNG NGÀY (/checkin)
// ==========================================
bot.command('checkin', async (ctx) => {
    const { id } = ctx.from;
    const today = new Date().toDateString();

    try {
        const user = await User.findOne({ telegramId: id.toString() });
        if (!user) return ctx.reply("❌ Vui lòng gõ lệnh /start trước khi điểm danh.");

        // Kiểm tra xem đã điểm danh hôm nay chưa thông qua trường ẩn
        if (user.toObject().lastCheckinDate === today) {
            return ctx.reply("❌ Hôm nay bạn đã nhận quà điểm danh rồi! Hãy quay lại vào ngày mai.", Markup.inlineKeyboard([miniAppButton]));
        }

        // Phần thưởng điểm danh cố định: 25,000 Xu
        const CHECKIN_REWARD = 25000; 
        user.totalCoins += CHECKIN_REWARD;
        
        // Ghi lại ngày điểm danh bằng phương thức .set() động của Mongoose
        user.set('lastCheckinDate', today);
        user.lastActiveDay = today;
        await user.save();

        ctx.replyWithMarkdown(
            `🎁 *ĐIỂM DANH HÀNG NGÀY THÀNH CÔNG!*\n\n` +
            `🎉 Phần thưởng: *+${CHECKIN_REWARD.toLocaleString()} Xu*\n` +
            `💰 Số dư tài khoản hiện tại: *${user.totalCoins.toLocaleString()} Xu*`, 
            Markup.inlineKeyboard([miniAppButton])
        );

    } catch (e) {
        console.error("Lỗi điểm danh:", e);
        ctx.reply("Hệ thống điểm danh đang bảo trì, vui lòng thử lại sau!");
    }
});

// ==========================================
// TÍNH NĂNG MỚI: VÒNG QUAY MAY MẮN VÀ THAY THẾ VĂN BẢN
// ==========================================
async function runLuckyWheel(ctx, isCallback = false) {
    const { id } = ctx.from;
    const COST_DIAMOND = 5; // Chi phí mỗi lượt quay: 5 Kim cương

    try {
        const user = await User.findOne({ telegramId: id.toString() });
        if (!user) {
            const msg = "❌ Vui lòng gõ lệnh /start trước.";
            return isCallback ? ctx.answerCbQuery(msg, { show_alert: true }) : ctx.reply(msg);
        }

        // Kiểm tra xem người dùng có đủ kim cương không
        if (user.diamonds < COST_DIAMOND) {
            const msg = `❌ Bạn không đủ Kim cương! Mỗi lượt quay yêu cầu *${COST_DIAMOND} 💎*.\n👉 Hãy vào MiniApp làm nhiệm vụ xem quảng cáo để kiếm thêm Kim cương nhé.`;
            
            if (isCallback) {
                return ctx.answerCbQuery("❌ Bạn không đủ Kim cương!", { show_alert: true });
            } else {
                return ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([miniAppButton]));
            }
        }

        // Khấu trừ kim cương
        user.diamonds -= COST_DIAMOND;

        // Danh sách cơ cấu giải thưởng
        const prizes = [
            { name: "😢 Chúc bạn may mắn lần sau!", type: "empty", value: 0 },
            { name: "💰 +20,000 Xu", type: "coin", value: 20000 },
            { name: "🔥 +100,000 Xu (Trúng lớn)", type: "coin", value: 100000 },
            { name: "💎 +2 Kim cương", type: "diamond", value: 2 },
            { name: "🆙 Tăng +1 Cấp độ (Level Up)", type: "levelup", value: 1 },
            { name: "💰 +50,000 Xu", type: "coin", value: 50000 }
        ];

        // Quay ngẫu nhiên phần quà
        const randomIndex = Math.floor(Math.random() * prizes.length);
        const prize = prizes[randomIndex];

        let resultText = `🎰 *VÒNG QUAY MAY MẮN 🎰*\n\n` +
                         `💸 Chi phí: -${COST_DIAMOND} 💎\n` +
                         `🎁 Quà nhận được: *${prize.name}*\n\n`;

        // Áp dụng phần thưởng vào tài khoản
        if (prize.type === 'coin') {
            user.totalCoins += prize.value;
            resultText += `💰 Số dư mới: *${user.totalCoins.toLocaleString()} Xu*`;
        } else if (prize.type === 'diamond') {
            user.diamonds += prize.value;
            resultText += `💎 Số dư Kim cương: *${user.diamonds} 💎*`;
        } else if (prize.type === 'levelup') {
            user.level += 1;
            const RATE_INCREASE_PER_LEVEL = 0.2;
            const baseRate = 12.0;
            const newMiningRate = baseRate + (user.level - 1) * baseRate * RATE_INCREASE_PER_LEVEL;
            user.miningRate = parseFloat(newMiningRate.toFixed(1));
            
            resultText += `🆙 Cấp độ mới: *Level ${user.level}*\n⚡ Tốc độ khai thác mới: *${user.miningRate} Xu/s*`;
        } else {
            resultText += `😢 Chúc bạn may mắn hơn ở các lượt quay kế tiếp!`;
        }

        await user.save();

        // Cấu trúc cụm phím Inline
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🎰 Quay tiếp (-5 💎)', 'spin_wheel')],
            miniAppButton
        ]);

        if (isCallback) {
            // Nếu click nút "Quay tiếp": Sửa nội dung đè lên bong bóng chat hiện tại
            await ctx.editMessageText(resultText, { parse_mode: 'Markdown', ...keyboard });
            await ctx.answerCbQuery("🎰 Kết quả mới đã xuất hiện!"); 
        } else {
            // Nếu gõ lệnh gốc /luckywheel: Gửi tin nhắn mới tinh làm gốc
            await ctx.replyWithMarkdown(resultText, keyboard);
        }

    } catch (e) {
        console.error("Lỗi xử lý vòng quay:", e);
        const errMsg = "Vòng quay đang bận, vui lòng thử lại sau!";
        if (isCallback) {
            ctx.answerCbQuery(errMsg, { show_alert: true });
        } else {
            ctx.reply(errMsg);
        }
    }
}

bot.command('luckywheel', async (ctx) => {
    await runLuckyWheel(ctx, false);
});

bot.action('spin_wheel', async (ctx) => {
    await runLuckyWheel(ctx, true);
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
