require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // ← AGREGADO: Para generar tokens

const app = express();
const PORT = process.env.PORT || 3001;

// 🔹 CONEXIÓN A MONGODB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB conectado'))
.catch(err => console.error('❌ Error MongoDB:', err));

// 🔹 MODELOS (ACTUALIZADOS CON VERIFICACIÓN)
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    // ✅ VALIDACIÓN DE DOMINIO: Solo @celco.com.co
    validate: {
      validator: function(v) {
        return !v || v.endsWith('@celco.com.co');
      },
      message: 'Solo se permiten correos corporativos @celco.com.co'
    }
  },
  password: { type: String, required: true },
  role: { type: String, default: 'tecnico' },
  // ✅ CAMPOS PARA VERIFICACIÓN POR EMAIL
  verified: { type: Boolean, default: false },
  verificationToken: String,
  tokenExpires: Date,
  createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});
const User = mongoose.model('User', UserSchema);

const SubmissionSchema = new mongoose.Schema({
  numeroServicio: { type: String, required: true },
  cliente: String,
  trabajo: String,
  notas: String,
  email_destino: String,
  firma_base64: String,
  usuario: String,
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  fechaEnvio: String,
  timestamp: { type: Date, default: Date.now },
  estado: { type: String, default: 'pendiente' }
});
const Submission = mongoose.model('Submission', SubmissionSchema);

// 🔹 MIDDLEWARE DE AUTENTICACIÓN JWT
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Acceso denegado' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecreto123');
    req.user = decoded;
    next();
  } catch (e) {
    res.status(400).json({ error: 'Token inválido' });
  }
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 🔹 GENERAR PDF PROFESIONAL (TU CÓDIGO ORIGINAL - SIN CAMBIOS)
function generarPDF(datos) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    doc.rect(0, 0, 595, 120).fill('#1565C0');
    doc.fontSize(28).fillColor('#FFFFFF').font('Helvetica-Bold')
       .text('CELCO S.A.S.', 120, 30, { align: 'left' });
    doc.fontSize(12).fillColor('#FFFFFF').font('Helvetica')
       .text('Servicio Técnico Especializado', 120, 55, { align: 'left' });
    doc.fontSize(16).fillColor('#FFFFFF').font('Helvetica-Bold')
       .text(`ORDEN DE SERVICIO #${datos.numeroServicio}`, 120, 80, { align: 'left' });
    doc.fontSize(10).fillColor('#E3F2FD')
       .text(`Fecha: ${datos.fechaEnvio}`, 120, 100)
       .text(`Técnico: ${datos.usuario || 'No registrado'}`, 120, 112);
    
    doc.moveDown(2).fontSize(14).fillColor('#1565C0').font('Helvetica-Bold')
       .text('INFORMACIÓN DEL CLIENTE', 40, 140);
    doc.fontSize(11).fillColor('#333333').font('Helvetica')
       .text(`Cliente: ${datos.cliente}`, 40, 165)
       .text(`Email: ${datos.email_destino}`, 40, 180)
       .text(`Trabajo Solicitado: ${datos.trabajo}`, 40, 195);
    
    doc.moveDown(0.5).fontSize(14).fillColor('#1565C0').font('Helvetica-Bold')
       .text('DETALLES DEL SERVICIO', 40, 220);
    doc.fontSize(11).fillColor('#333333').font('Helvetica')
       .text(datos.notas || 'Sin notas adicionales', 40, 245, {
         width: 515, align: 'left', lineHeight: 1.6
       });
    
    if (datos.firma_base64) {
      const firmaData = datos.firma_base64.replace(/^image\/png;base64,/, '');
      const signaturePath = path.join(__dirname, 'temp_signature.png');
      try {
        fs.writeFileSync(signaturePath, firmaData, 'base64');
        doc.fontSize(11).fillColor('#1565C0').font('Helvetica-Bold')
           .text('FIRMA DEL CLIENTE', 40, 340);
        doc.image(signaturePath, 40, 360, { width: 200, align: 'left' });
        setTimeout(() => fs.unlinkSync(signaturePath), 1000);
      } catch (err) { console.error('Error con la firma:', err); }
    }
    
    const pageHeight = doc.page.height;
    doc.fontSize(9).fillColor('#999999').font('Helvetica')
       .text('Celco S.A.S. - Todos los derechos reservados', 40, pageHeight - 40, { align: 'center', width: 515 })
       .text('Documento generado electrónicamente', 40, pageHeight - 28, { align: 'center', width: 515 });
    doc.end();
  });
}

// 🔹 ENDPOINT: REGISTRO CON VERIFICACIÓN POR EMAIL (ACTUALIZADO)
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // ✅ Validar dominio @celco.com.co
    if (!email || !email.endsWith('@celco.com.co')) {
      return res.status(400).json({ error: 'Solo se permiten correos corporativos @celco.com.co' });
    }
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Usuario o email ya registrado' });
    }
    
    // Generar token de verificación
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
    
    // Crear usuario (NO verificado aún)
    const user = new User({ 
      username, 
      email, 
      password,
      verificationToken,
      tokenExpires
    });
    await user.save();
    
    // 🔹 Enviar email de verificación con Brevo
    const verificationLink = `${process.env.RAILWAY_PUBLIC_DOMAIN || 'https://backend-formulario-production.up.railway.app'}/api/verify-email?token=${verificationToken}`;
    
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: "Celco S.A.S - Sistema", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: email, name: username }],
        subject: 'Verifica tu cuenta - Formulario Celco',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #1565C0; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1>CELCO S.A.S</h1>
              <p>Verificación de Cuenta</p>
            </div>
            <div style="background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px;">
              <h2 style="color: #1565C0;">¡Bienvenido ${username}!</h2>
              <p>Para activar tu cuenta en el sistema de formularios, haz clic en el siguiente botón:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationLink}" style="background-color: #1565C0; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                   VERIFICAR MI CUENTA
                </a>
              </div>
              <p style="color: #666; font-size: 14px;">
                O copia y pega este enlace en tu navegador:<br>
                <a href="${verificationLink}">${verificationLink}</a>
              </p>
              <p style="color: #999; font-size: 12px; margin-top: 30px;">
                Este enlace expira en 24 horas.<br>
                Si no solicitaste esta cuenta, ignora este email.
              </p>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
              <p>Celco S.A.S - Todos los derechos reservados</p>
            </div>
          </div>
        `
      })
    });
    
    if (!brevoResponse.ok) {
      console.error('Error enviando email de verificación:', await brevoResponse.json());
    }
    
    res.json({ 
      message: 'Registro exitoso. Revisa tu email corporativo @celco.com.co para verificar la cuenta.',
      email: email
    });
    
  } catch (error) {
    console.error('❌ Error registro:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// 🔹 ENDPOINT: VERIFICAR EMAIL (NUEVO)
app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'Token no proporcionado' });
    }
    
    // Buscar usuario con ese token y que no haya expirado
    const user = await User.findOne({
      verificationToken: token,
      tokenExpires: { $gt: new Date() },
      verified: false
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Token inválido o expirado. Solicita un nuevo registro.' });
    }
    
    // Marcar como verificado y limpiar token
    user.verified = true;
    user.verificationToken = undefined;
    user.tokenExpires = undefined;
    await user.save();
    
    // Responder con HTML bonito
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cuenta Verificada</title>
        <style>
          body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #1565C0 0%, #0D47A1 100%); display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); text-align: center; max-width: 400px; }
          .icon { font-size: 80px; margin-bottom: 20px; }
          h1 { color: #1565C0; margin-bottom: 10px; }
          p { color: #666; margin-bottom: 30px; }
          .btn { background-color: #1565C0; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>¡Cuenta Verificada!</h1>
          <p>Tu cuenta de <strong>${user.username}</strong> ha sido activada exitosamente.</p>
          <p>Ya puedes iniciar sesión en la aplicación móvil.</p>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Error verificando email:', error);
    res.status(500).json({ error: 'Error al verificar el email' });
  }
});

// 🔹 ENDPOINT: LOGIN (SOLO USUARIOS VERIFICADOS - ACTUALIZADO)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Usuario no encontrado' });
    }
    
    // ✅ Verificar que el email esté confirmado
    if (!user.verified) {
      return res.status(403).json({ 
        error: 'Cuenta no verificada. Revisa tu email @celco.com.co y haz clic en el link de verificación.' 
      });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Contraseña incorrecta' });
    }
    
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'supersecreto123',
      { expiresIn: '7d' }
    );
    
    res.json({ 
      message: 'Login exitoso', 
      token, 
      username: user.username,
      email: user.email 
    });
  } catch (error) {
    console.error('❌ Error login:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// 🔹 ENDPOINT PRINCIPAL - Recibir formulario (TU CÓDIGO ORIGINAL - SIN CAMBIOS)
app.post('/api/formulario', authMiddleware, async (req, res) => {
  try {
    console.log('📩 Received:', req.body);
    const { cliente, trabajo, notas, email_destino, firma_base64, usuario } = req.body;
    const user = await User.findById(req.user.id);
    const nombreUsuario = user ? user.username : (usuario || 'admin');
    
    const count = await Submission.countDocuments();
    const numeroServicio = `SRV-${1001 + count}`;
    const fechaEnvio = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    
    const submission = new Submission({
      numeroServicio, cliente, trabajo, notas, email_destino, firma_base64,
      usuario: nombreUsuario, usuarioId: user?._id, fechaEnvio, timestamp: new Date(), estado: 'pendiente'
    });
    await submission.save();
    
    const pdfBuffer = await generarPDF({ ...submission.toObject(), fechaEnvio });
    
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: "Celco S.A.S", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: email_destino }],
        cc: [{ email: process.env.BREVO_SENDER_EMAIL }],
        subject: `Orden de Servicio #${numeroServicio} - ${cliente}`,
        htmlContent: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;"><div style="background-color: #1565C0; color: white; padding: 20px; text-align: center;"><h1>CELCO S.A.S</h1><h2>Orden de Servicio #${numeroServicio}</h2></div><div style="padding: 20px; background-color: #f5f5f5;"><h3 style="color: #1565C0;">Detalles del Servicio</h3><p><strong>Cliente:</strong> ${cliente}</p><p><strong>Trabajo:</strong> ${trabajo}</p><p><strong>Fecha:</strong> ${fechaEnvio}</p><p><strong>Técnico:</strong> ${nombreUsuario}</p><div style="background-color: white; padding: 15px; border-left: 4px solid #1565C0; margin: 20px 0;"><p style="margin: 0;"><strong>Notas:</strong></p><p style="margin: 5px 0 0 0;">${notas || 'Sin notas adicionales'}</p></div></div><div style="padding: 20px; text-align: center; color: #999; font-size: 12px;"><p>Celco S.A.S - Servicio Técnico Especializado</p></div></div>`,
        attachment: [{ name: `Orden_${numeroServicio}.pdf`, content: pdfBuffer.toString('base64') }]
      })
    });

    if (!brevoResponse.ok) {
      const errorData = await brevoResponse.json();
      console.error('❌ Error Brevo:', errorData);
      submission.estado = 'error_email';
      await submission.save();
    } else {
      submission.estado = 'enviado';
      await submission.save();
      console.log('✅ Email enviado con éxito');
    }
    
    res.json({ success: true, message: 'Formulario guardado y enviado', numeroServicio });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🔹 ENDPOINT: Estadísticas con filtro por fechas (TU CÓDIGO ORIGINAL - SIN CAMBIOS)
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.timestamp = { $gte: new Date(startDate), $lte: new Date(endDate + 'T23:59:59.999Z') };
    }
    const total = await Submission.countDocuments(dateFilter);
    const enviados = await Submission.countDocuments({ ...dateFilter, estado: 'enviado' });
    const pendientes = await Submission.countDocuments({ ...dateFilter, $or: [{ estado: 'pendiente' }, { estado: 'error_email' }] });
    const porDia = await Submission.aggregate([
      { $match: dateFilter },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    const ultimosEnvios = await Submission.find(dateFilter).sort({ timestamp: -1 }).limit(10).select('numeroServicio cliente fechaEnvio usuarioNombre estado');
    
    res.json({
      resumen: { total, enviados, pendientes, rango: startDate ? `${startDate} a ${endDate}` : 'Todo el tiempo' },
      porDia,
      ultimosEnvios
    });
  } catch (error) {
    console.error('❌ Error stats:', error);
    res.status(500).json({ error: 'Error cargando estadísticas' });
  }
});

// 🔹 ENDPOINT: Obtener todos los envíos (TU CÓDIGO ORIGINAL - SIN CAMBIOS)
app.get('/api/submissions', authMiddleware, async (req, res) => {
  try {
    const lista = await Submission.find().sort({ timestamp: -1 }).select('numeroServicio cliente trabajo usuario fechaEnvio estado');
    res.json(lista);
  } catch (error) {
    console.error('❌ Error submissions:', error);
    res.status(500).json({ error: 'Error cargando envíos' });
  }
});

// 🔹 ENDPOINT: Obtener un envío específico (TU CÓDIGO ORIGINAL - SIN CAMBIOS)
app.get('/api/submissions/:id', authMiddleware, async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    if (!submission) { return res.status(404).json({ error: 'No encontrado' }); }
    res.json(submission);
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
  console.log(`🔐 Auth: /api/login, /api/register, /api/verify-email`);
});