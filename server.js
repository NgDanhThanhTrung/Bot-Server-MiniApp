const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User'); 

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// ==========================================
// 1. CẤU HÌNH KINH TẾ (20,000 XU = 1 VNĐ)
// ==========================================
const EXCHANGE_RATE = 20000;    
const START_REWARD = 50000;     
const REF_REWARD = 100000;      
const USERS_PER_PAGE = 5;       

// Bộ nhớ đệm cục bộ phòng chống spam/click tặc đồng thời (Anti-Race Condition Lock)
const processingLocks = new Set();

// Kết nối MongoDB với các cấu hình tối ưu hiệu năng
mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('✅ Bot Server đã kết nối Database Kinh Tế 2.0');
        registerBotCommands();
    })
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

const miniAppButton = [Markup.button.webApp('🎮 MỞ MÁY ĐÀO XU', process.env.WEB_URL)];

// ==========================================
// TỰ ĐỘNG PHÂN TÁCH MENU LỆNH CHO USER & ADMIN
// ==========================================
async function registerBotCommands() {
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: '🚀 Khởi động máy đào & Xem số dư' },
            { command: 'checkin', description: '🎁 Điểm danh hàng ngày nhận Xu' },
            { command: 'luckywheel', description: '🎰 Vòng quay may mắn bằng Kim cương' },
            { command: 'myid', description: '🆔 Xem ID Telegram của bản thân' }
        ], { scope: { type: 'default' } });

        if (process.env.ADMIN_ID) {
            await bot.telegram.setMyCommands([
                { command: 'start', description: '🚀 Khởi động máy đào & Xem số dư' },
                { command: 'checkin', description: '🎁 Điểm danh hàng ngày nhận Xu' },
                { command: 'luckywheel', description: '🎰 Vòng quay may mắn bằng Kim cương' },
                { command: 'myid', description: '🆔 Xem ID Telegram của bản thân' },
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

    const users = await User.find()
        .sort({ totalCoins: -1 })
        .skip((page - 1) * USERS_PER_PAGE)
        .limit(USERS_PER_PAGE)
        .lean(); // .lean() giúp tăng tốc độ đọc dữ liệu nhanh gấp 3 lần vì không tạo Mongoose Document ảo

    let text = `🏆 *DANH SÁCH TOÀN BỘ NGƯỜI DÙNG (Trang ${page}/${totalPages})*\n`;
    text += `👥 Tổng số thợ đào trên hệ thống: *${totalUsers}*\n\n`;

    const startIndex = (page - 1) * USERS_PER_PAGE;
    users.forEach((u, i) => {
        const usernameText = u.username && u.username !== 'n/a' ? `@${u.username}` : 'Không có';
        text += `${startIndex + i + 1}. *${u.name || 'Thợ đào'}*\n` +
                `    ├ 🆔 ID: \`${u.telegramId}\`\n` +
                `    ├ 👤 User: ${usernameText}\n` +
                `    ├ 💰 Số Xu: *${(u.totalCoins || 0).toLocaleString()} Xu*\n` +
                `    └ 💎 Kim cương: *${u.diamonds || 0} 💎*\n\n`;
    });

    const buttons = [];
    const navRow = [];
    
    if (page > 1) navRow.push(Markup.button.callback('◀️ Trang trước', `list_page_${page - 1}`));
    if (page < totalPages) navRow.push(Markup.button.callback('Trang sau ▶️', `list_page_${page + 1}`));
    if (navRow.length > 0) buttons.push(navRow);

    buttons.push(miniAppButton);
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

// ==========================================
// 2. LOGIC XỬ LÝ LỆNH /START
// ==========================================
bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const startPayload = ctx.startPayload ? ctx.startPayload.trim() : null; 
    const today = new Date().toDateString();
    const lockKey = `start_${id}`;

    if (processingLocks.has(lockKey)) return;
    processingLocks.add(lockKey);
    
    try {
        let user = await User.findOne({ telegramId: id.toString() });

        if (!user) {
            user = new User({
                telegramId: id.toString(),
                username: username || 'n/a',
                name: first_name || 'Người dùng',
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

            // Chống tự cheat link giới thiệu của chính bản thân mình
            if (startPayload && startPayload !== id.toString()) {
                const inviter = await User.findOne({ telegramId: startPayload });
                if (inviter) {
                    // Nguyên tử hóa việc cộng tiền mời, triệt tiêu bug cheat nhân bản số xu của người mời
                    await User.updateOne(
                        { telegramId: startPayload },
                        { $inc: { totalCoins: REF_REWARD, refs: 1 } }
                    );

                    user.referredBy = startPayload;

                    try {
                        await bot.telegram.sendMessage(startPayload, 
                            `🎉 *Mời bạn thành công!*\nBạn nhận được *+${REF_REWARD.toLocaleString()} Xu* vì đã mời ${first_name || 'thành viên mới'} tham gia!`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (e) { console.log(`Gửi thông báo ref thất bại tới ${startPayload}`); }
                }
            }
            await user.save();
        } else {
            // Đồng bộ lại tên mới phòng trường hợp đổi tên trên Telegram
            user.name = first_name || user.name;
            user.username = username || user.username;
            
            if (user.lastActiveDay !== today) {
                user.adsWatchedToday = 0;
                user.lastActiveDay = today;
            }
            await user.save();
        }

        const vndValue = (user.totalCoins / EXCHANGE_RATE).toLocaleString('vi-VN');
        const welcomeMsg = `🚀 *CHÀO MỪNG ĐẾN VỚI MÁY ĐÀO XU 2.0*\n\n` +
                           `👤 Chủ nhân: *${user.name}*\n` +
                           `📊 Cấp độ: *Level ${user.level}*\n` +
                           `⚡ Tốc độ đào: *${user.miningRate} Xu/s*\n` +
                           `💰 Số dư: *${user.totalCoins.toLocaleString()} Xu*\n` +
                           `💸 Quy đổi: *~${vndValue} VNĐ*\n` +
                           `💎 Kim cương: *${user.diamonds}*\n\n` +
                           `👇 Bạn có thể chạm nhanh vào nút **Menu** ở góc trái để thao tác nhanh hơn!`;

        await ctx.replyWithMarkdown(welcomeMsg, Markup.inlineKeyboard([miniAppButton]));
    } catch (e) {
        console.error("❌ Lỗi Start Bot:", e);
        await ctx.reply("Hệ thống đang bận, vui lòng thử lại sau!");
    } finally {
        processingLocks.delete(lockKey);
    }
});

bot.command('myid', async (ctx) => {
    const { id, first_name } = ctx.from;
    await ctx.replyWithMarkdown(`👤 Tài khoản: *${first_name || 'Thợ đào'}*\n🆔 ID Telegram của bạn là: \`${id}\`\n\n_(Chạm tay vào số ID ở trên để sao chép nhanh)_`);
});

// ==========================================
// TÍNH NĂNG: ĐIỂM DANH TUẦN TỰ (STREAK 7 NGÀY) - GIỚI HẠN 1 NGÀY/LẦN
// (Tối ưu hóa: Chống cheat, không sửa file User.js)
// ==========================================
// ==========================================
// TÍNH NĂNG ĐỘT PHÁ: ĐIỂM DANH CHUỖI 7 NGÀY (STREAK) - MÚI GIỜ VN & TTL LOCK
// ==========================================
bot.command('checkin', async (ctx) => {
    const { id } = ctx.from;
    
    // 1. CHUẨN HÓA MÚI GIỜ: Lấy chuỗi ngày theo múi giờ Việt Nam (GMT+7)
    // Tránh việc Server đặt ở nước ngoài làm lệch chuỗi ngày của người chơi
    const getVNStringDate = (offsetDays = 0) => {
        const d = new Date();
        if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
        return d.toLocaleDateString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }); // Trả về dạng: "M/D/YYYY"
    };

    const todayStr = getVNStringDate(0);
    const yesterdayStr = getVNStringDate(-1);
    const lockKey = `checkin_${id}`;

    // 2. KHÓA TTL LOCK: Chống spam request đồng thời và chống kẹt khóa nếu crash
    if (processingLocks.has(lockKey)) return;
    processingLocks.add(lockKey);
    // Tự động giải phóng khóa sau 5 giây để bảo vệ tài khoản không bị treo nếu DB phản hồi chậm
    const lockTimeout = setTimeout(() => processingLocks.delete(lockKey), 5000);

    try {
        const user = await User.findOne({ telegramId: id.toString() });
        if (!user) return await ctx.reply("❌ Vui lòng gõ lệnh /start trước khi điểm danh.");

        // Kiểm tra xem hôm nay người dùng đã điểm danh chưa
        if (user.lastCheckinDate === todayStr) {
            clearTimeout(lockTimeout);
            processingLocks.delete(lockKey);
            return await ctx.reply(
                `⚠️ Hôm nay bạn đã nhận quà điểm danh rồi!\n🔥 Chuỗi hiện tại: *Ngày ${user.checkinStreak}/7*\n\n👉 Hãy quay lại vào ngày mai để nhận mốc thưởng tiếp theo!`, 
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard([miniAppButton]) }
            );
        }

        // 3. LOGIC TÍNH TOÁN CHUỖI (STREAK)
        let nextStreak = user.checkinStreak || 0;
        if (user.lastCheckinDate === yesterdayStr) {
            // Điểm danh liên tục từ hôm qua -> Tăng chuỗi lên 1 (Tối đa 7 ngày rồi reset lại chuỗi mới)
            nextStreak = nextStreak >= 7 ? 1 : nextStreak + 1;
        } else {
            // Bỏ quên không điểm danh (Đứt chuỗi) -> Reset về Ngày 1
            nextStreak = 1;
        }

        // 4. ĐỊNH NGHĨA PHẦN THƯỞNG TĂNG TIẾN
        const streakRewards = {
            1: { coins: 10000, diamonds: 0 },
            2: { coins: 15000, diamonds: 0 },
            3: { coins: 20000, diamonds: 0 },
            4: { coins: 25000, diamonds: 0 },
            5: { coins: 30000, diamonds: 0 },
            6: { coins: 40000, diamonds: 0 },
            7: { coins: 60000, diamonds: 1 } // Ngày cuối tặng thêm 1 Kim cương giá trị
        };

        const currentReward = streakRewards[nextStreak];

        // 5. ATOMIC UPDATE (CẬP NHẬT NGUYÊN TỬ): Chống cheat tuyệt đối ở tầng Database
        const updatedUser = await User.findOneAndUpdate(
            { 
                telegramId: id.toString(),
                lastCheckinDate: { $ne: todayStr } // Chỉ cập nhật nếu ngày lưu thực sự khác hôm nay
            },
            { 
                $inc: { 
                    totalCoins: currentReward.coins, 
                    diamonds: currentReward.diamonds 
                },
                $set: { 
                    lastCheckinDate: todayStr, 
                    checkinStreak: nextStreak,
                    lastActiveDay: todayStr 
                }
            },
            { new: true } // Trả về dữ liệu mới nhất sau khi cộng tiền
        );

        if (!updatedUser) {
            clearTimeout(lockTimeout);
            processingLocks.delete(lockKey);
            return await ctx.reply("❌ Thao tác quá nhanh hoặc bạn đã điểm danh hôm nay rồi!");
        }

        // 6. THIẾT KẾ ĐỒ HỌA VĂN BẢN (PROGRESS BAR) TRỰC QUAN
        let progressBars = "";
        for (let i = 1; i <= 7; i++) {
            if (i < nextStreak) progressBars += "✅";
            else if (i === nextStreak) progressBars += "🔥";
            else progressBars += "⬜";
        }

        let rewardText = `🎁 *ĐIỂM DANH THÀNH CÔNG (Ngày ${nextStreak}/7)*\n\n` +
                         `✨ Phần thưởng: *+${currentReward.coins.toLocaleString()} Xu* ${currentReward.diamonds > 0 ? `và *+${currentReward.diamonds} 💎*` : ''}\n` +
                         `📊 Tiến độ chuỗi: ${progressBars}\n\n` +
                         `💰 Số dư tài khoản: *${updatedUser.totalCoins.toLocaleString()} Xu*`;

        if (nextStreak === 7) {
            rewardText += `\n\n🎉 *Chúc mừng bạn đã hoàn thành trọn vẹn chuỗi 7 ngày! Vòng lặp thưởng mới sẽ tự động làm mới vào ngày mai.*`;
        } else {
            rewardText += `\n\n💡 Ngày mai bấm tiếp để nhận mốc lớn hơn: *+${streakRewards[nextStreak + 1].coins.toLocaleString()} Xu*`;
        }

        await ctx.replyWithMarkdown(rewardText, Markup.inlineKeyboard([miniAppButton]));

    } catch (e) {
        console.error("❌ Lỗi xử lý điểm danh chuỗi:", e);
        await ctx.reply("Hệ thống điểm danh đang bảo trì, vui lòng thử lại sau!");
    } finally {
        // Luôn giải phóng khóa và xóa bộ đếm thời gian khi kết thúc thành công
        clearTimeout(lockTimeout);
        processingLocks.delete(lockKey);
    }
});

// ==========================================
// TÍNH NĂNG MỚI: VÒNG QUAY MAY MẮN VÀ THAY THẾ VĂN BẢN
// ==========================================
async function runLuckyWheel(ctx, isCallback = false) {
    const { id } = ctx.from;
    const COST_DIAMOND = 5; 
    const lockKey = `wheel_${id}`;

    if (processingLocks.has(lockKey)) {
        return isCallback ? ctx.answerCbQuery("🎰 Vòng quay đang xử lý, đừng bấm liên tục!", { show_alert: true }) : null;
    }
    processingLocks.add(lockKey);

    try {
        // Áp dụng Atomic Update: Chỉ trừ kim cương ĐỐI VỚI những ai có kim cương lớn hơn hoặc bằng chi phí
        // Loại bỏ hoàn toàn lỗi cheat "Kim cương âm" do click nhanh
        const updatedUser = await User.findOneAndUpdate(
            { telegramId: id.toString(), diamonds: { $gte: COST_DIAMOND } },
            { $inc: { diamonds: -COST_DIAMOND } },
            { new: true }
        );

        if (!updatedUser) {
            const msg = `❌ Bạn không đủ Kim cương! Mỗi lượt quay yêu cầu *${COST_DIAMOND} 💎*.\n👉 Hãy vào MiniApp làm nhiệm vụ xem quảng cáo để kiếm thêm Kim cương nhé.`;
            if (isCallback) {
                return await ctx.answerCbQuery("❌ Bạn không đủ Kim cương!", { show_alert: true });
            } else {
                return await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([miniAppButton]));
            }
        }

        const prizes = [
            { name: "😢 Chúc bạn may mắn lần sau!", type: "empty", value: 0 },
            { name: "💰 +20,000 Xu", type: "coin", value: 20000 },
            { name: "🔥 +100,000 Xu (Trúng lớn)", type: "coin", value: 100000 },
            { name: "💎 +2 Kim cương", type: "diamond", value: 2 },
            { name: "🆙 Tăng +1 Cấp độ (Level Up)", type: "levelup", value: 1 },
            { name: "💰 +50,000 Xu", type: "coin", value: 50000 }
        ];

        const randomIndex = Math.floor(Math.random() * prizes.length);
        const prize = prizes[randomIndex];

        let resultText = `🎰 *VÒNG QUAY MAY MẮN 🎰*\n\n` +
                         `💸 Chi phí: -${COST_DIAMOND} 💎\n` +
                         `🎁 Quà nhận được: *${prize.name}*\n\n`;

        // Cộng thưởng trực tiếp bằng toán tử Mongoose tăng tiến vô cùng bảo mật
        let finalUser;
        if (prize.type === 'coin') {
            finalUser = await User.findOneAndUpdate({ telegramId: id.toString() }, { $inc: { totalCoins: prize.value } }, { new: true });
            resultText += `💰 Số dư mới: *${finalUser.totalCoins.toLocaleString()} Xu*`;
        } else if (prize.type === 'diamond') {
            finalUser = await User.findOneAndUpdate({ telegramId: id.toString() }, { $inc: { diamonds: prize.value } }, { new: true });
            resultText += `💎 Số dư Kim cương: *${finalUser.diamonds} 💎*`;
        } else if (prize.type === 'levelup') {
            // Level-up yêu cầu lấy thông tin level hiện tại và áp công thức đồng bộ
            const currentLevel = updatedUser.level + 1;
            const RATE_INCREASE_PER_LEVEL = 0.2;
            const baseRate = 12.0;
            const newMiningRate = parseFloat((baseRate + (currentLevel - 1) * baseRate * RATE_INCREASE_PER_LEVEL).toFixed(1));
            
            finalUser = await User.findOneAndUpdate(
                { telegramId: id.toString() }, 
                { $set: { level: currentLevel, miningRate: newMiningRate } }, 
                { new: true }
            );
            resultText += `🆙 Cấp độ mới: *Level ${finalUser.level}*\n⚡ Tốc độ khai thác mới: *${finalUser.miningRate} Xu/s*`;
        } else {
            resultText += `💎 Số dư Kim cương: *${updatedUser.diamonds} 💎*\n😢 Chúc bạn may mắn hơn ở các lượt quay kế tiếp!`;
        }

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🎰 Quay tiếp (-5 💎)', 'spin_wheel')],
            miniAppButton
        ]);

        if (isCallback) {
            await ctx.editMessageText(resultText, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
            await ctx.answerCbQuery("🎰 Kết quả mới đã xuất hiện!"); 
        } else {
            await ctx.replyWithMarkdown(resultText, keyboard);
        }
    } catch (e) {
        console.error("Lỗi xử lý vòng quay:", e);
        const errMsg = "Vòng quay đang bận, vui lòng thử lại sau!";
        if (isCallback) {
            await ctx.answerCbQuery(errMsg, { show_alert: true }).catch(() => {});
        } else {
            await ctx.reply(errMsg);
        }
    } finally {
        processingLocks.delete(lockKey);
    }
}

bot.command('luckywheel', async (ctx) => {
    await runLuckyWheel(ctx, false);
});

bot.action('spin_wheel', async (ctx) => {
    await runLuckyWheel(ctx, true);
});

// ==========================================
// 4. LỆNH ADMIN (BẢO MẬT TUYỆT ĐỐI & CHỐNG BUG)
// ==========================================

bot.command('broadcast', async (ctx) => {
    if (!process.env.ADMIN_ID || ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) return await ctx.reply("❌ Nhập nội dung: /broadcast [Nội dung]");

    const users = await User.find({}).select('telegramId').lean();
    await ctx.reply(`🚀 Đang tiến hành gửi thông báo ẩn tới ${users.length} thợ đào...`);

    let success = 0;
    // Sử dụng cơ chế gửi tuần tự an toàn tránh vượt ngưỡng giới hạn API Telegram (Rate limit)
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 *THÔNG BÁO HỆ THỐNG*\n\n${msg}`, { parse_mode: 'Markdown' });
            success++;
            await new Promise(r => setTimeout(r, 40)); 
        } catch (e) { 
            // Bỏ qua nếu user đã chặn/block bot
            continue; 
        }
    }
    await ctx.reply(`✅ Đã gửi thành công tới ${success}/${users.length} người dùng.`);
});

bot.command('list', async (ctx) => {
    if (!process.env.ADMIN_ID || ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    try {
        const { text, keyboard } = await getUserListPage(1); 
        await ctx.replyWithMarkdown(text, keyboard);
    } catch (e) { 
        console.error("Lỗi lấy dữ liệu /list:", e);
        await ctx.reply("Lỗi lấy dữ liệu hệ thống."); 
    }
});

bot.action(/^list_page_(\d+)$/, async (ctx) => {
    if (!process.env.ADMIN_ID || ctx.from.id.toString() !== process.env.ADMIN_ID) {
        return await ctx.answerCbQuery("❌ Bạn không có quyền truy cập dữ liệu quản trị!", { show_alert: true });
    }
    try {
        const targetPage = parseInt(ctx.match[1]);
        const { text, keyboard } = await getUserListPage(targetPage);
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
        await ctx.answerCbQuery();
    } catch (e) {
        console.error("Lỗi cập nhật trang:", e);
        await ctx.answerCbQuery("Không thể đổi trang.");
    }
});

// CỘNG XU CHO NGƯỜI DÙNG (CÓ CHECK ANTI-SPAM SỐ ÂM)
bot.command('addcoin', async (ctx) => {
    if (!process.env.ADMIN_ID || ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 3) return await ctx.reply("❌ Sai cú pháp! Vui lòng nhập: /addcoin [telegramId] [số xu]");

    const targetId = args[1].trim();
    const amountCoins = parseInt(args[2]);

    // Bảo mật: Không cho phép nhập số âm để trục lợi hoặc phá hoại trừ xu bừa bãi
    if (isNaN(amountCoins) || amountCoins <= 0) return await ctx.reply("❌ Số tiền cộng phải là số nguyên dương lớn hơn 0!");

    try {
        const user = await User.findOneAndUpdate(
            { telegramId: targetId },
            { $inc: { totalCoins: amountCoins } },
            { new: true }
        );

        if (!user) return await ctx.reply("❌ Không tìm thấy người dùng này trong hệ thống.");

        await ctx.replyWithMarkdown(`✅ Đã cộng *+${amountCoins.toLocaleString()} Xu* cho người dùng *${user.name}* (ID: ${targetId}).\n💰 Số dư mới: *${user.totalCoins.toLocaleString()} Xu*`);
        
        try {
            await bot.telegram.sendMessage(targetId, `🎁 Bạn vừa được Admin tặng *+${amountCoins.toLocaleString()} Xu* vào tài khoản!`, { parse_mode: 'Markdown' });
        } catch (err) { console.log(`Không thể gửi tin nhắn báo cho tài khoản ${targetId}`); }
    } catch (e) {
        await ctx.reply("❌ Có lỗi xảy ra khi thực hiện lệnh.");
    }
});

// CỘNG KIM CƯƠNG CHO NGƯỜI DÙNG (CÓ CHECK ANTI-SPAM SỐ ÂM)
bot.command('adddiamond', async (ctx) => {
    if (!process.env.ADMIN_ID || ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 3) return await ctx.reply("❌ Sai cú pháp! Vui lòng nhập: /adddiamond [telegramId] [số kim cương]");

    const targetId = args[1].trim();
    const amountDiamonds = parseInt(args[2]);

    if (isNaN(amountDiamonds) || amountDiamonds <= 0) return await ctx.reply("❌ Số kim cương cộng phải là số nguyên dương lớn hơn 0!");

    try {
        const user = await User.findOneAndUpdate(
            { telegramId: targetId },
            { $inc: { diamonds: amountDiamonds } },
            { new: true }
        );

        if (!user) return await ctx.reply("❌ Không tìm thấy người dùng này trong hệ thống.");

        await ctx.replyWithMarkdown(`✅ Đã cộng *+${amountDiamonds.toLocaleString()} 💎* cho người dùng *${user.name}* (ID: ${targetId}).\n💎 Số dư mới: *${user.diamonds} Kim cương*`);
        
        try {
            await bot.telegram.sendMessage(targetId, `🎁 Bạn vừa được Admin tặng *+${amountDiamonds.toLocaleString()} 💎* vào tài khoản!`, { parse_mode: 'Markdown' });
        } catch (err) { console.log(`Không thể gửi tin nhắn báo cho tài khoản ${targetId}`); }
    } catch (e) {
        await ctx.reply("❌ Có lỗi xảy ra khi thực hiện lệnh.");
    }
});

// THAY ĐỔI LEVEL CHO NGƯỜI DÙNG (TỰ ĐỘNG TÍNH TOÁN AN TOÀN)
bot.command('setlevel', async (ctx) => {
    if (!process.env.ADMIN_ID || ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 3) return await ctx.reply("❌ Sai cú pháp! Vui lòng nhập: /setlevel [telegramId] [Level]");

    const targetId = args[1].trim();
    const newLevel = parseInt(args[2]);

    if (isNaN(newLevel) || newLevel < 1) return await ctx.reply("❌ Cấp độ phải là số nguyên lớn hơn hoặc bằng 1!");

    try {
        const RATE_INCREASE_PER_LEVEL = 0.2;
        const baseRate = 12.0;
        const newMiningRate = parseFloat((baseRate + (newLevel - 1) * baseRate * RATE_INCREASE_PER_LEVEL).toFixed(1));

        const user = await User.findOneAndUpdate(
            { telegramId: targetId },
            { $set: { level: newLevel, miningRate: newMiningRate } },
            { new: true }
        );

        if (!user) return await ctx.reply("❌ Không tìm thấy người dùng này trong hệ thống.");

        await ctx.replyWithMarkdown(`✅ Đã điều chỉnh tài khoản *${user.name}* lên *Level ${newLevel}*.\n⚡ Tốc độ khai thác mới: *${user.miningRate} Xu/s*`);

        try {
            await bot.telegram.sendMessage(targetId, `🆙 Tài khoản của bạn đã được thay đổi lên *Level ${newLevel}* bởi Admin!\n⚡ Tốc độ đào mới: *${user.miningRate} Xu/s*`, { parse_mode: 'Markdown' });
        } catch (err) { console.log(`Không thể gửi tin nhắn báo cho tài khoản ${targetId}`); }
    } catch (e) {
        await ctx.reply("❌ Có lỗi xảy ra khi thực hiện lệnh.");
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
