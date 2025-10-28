// نقطة الدخول لـ Vercel
const app = require('../index.js');

module.exports = (req, res) => {
  // Vercel يتطلب تصدير دالة
  return app(req, res);
};