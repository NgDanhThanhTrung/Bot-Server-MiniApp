const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true, index: true },
  username: { type: String, default: '' },
  
  // Tài sản trong game
  totalCoins: { type: Number, default: 0, min: 0 },
  diamonds: { type: Number, default: 0, min: 0 },
  
  // Chỉ số máy đào
  level: { type: Number, default: 1, min: 1 },
  isMining: { type: Boolean, default: false },
  miningStartedAt: { type: Date, default: null },
  miningRate: { type: Number, default: 12.0 }, // Mặc định Level 1 là 12.0 xu/giây
  
  // Chỉ số quảng cáo & Nhiệm vụ chống cheat
  adsWatchedToday: { type: Number, default: 0, min: 0 },
  lastActiveDay: { type: String, default: '' }, // Lưu chuỗi dạng YYYY-MM-DD để reset ads mỗi ngày
  
  // Hệ thống Referral chống clone
  referredBy: { type: Number, default: null },
  referralRewardClaimed: { type: Boolean, default: false } // Đánh dấu nếu tài khoản này đã kích hoạt thưởng cho người giới thiệu
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
