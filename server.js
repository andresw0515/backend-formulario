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
const crypto = require('crypto');

// === 🆕 NUEVO: Paquete para geolocalización inversa ===
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// 🔹 CONEXIÓN A MONGODB
mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log('✅ MongoDB conectado'))
.catch(err => console.error('❌ Error MongoDB:', err));

// 🔹 MODELOS (ACTUALIZADOS CON VERIFICACIÓN)
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    validate: {
      validator: function(v) {
        return !v || v.endsWith('@celco.com.co');
      },
      message: 'Solo se permiten correos corporativos @celco.com.co'
    }
  },
  password: { type: String, required: true },
  role: { type: String, default: 'tecnico' },
  verified: { type: Boolean, default: false },
  verificationToken: String,
  tokenExpires: Date,
  createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});
const User = mongoose.model('User', UserSchema);

// === 🆕 NUEVO: Schema actualizado con campos para Carta de Servicio ===
const SubmissionSchema = new mongoose.Schema({
  // === CAMPOS EXISTENTES (NO TOCAR) ===
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
  estado: { type: String, default: 'pendiente' },
  
  // === 🆕 NUEVOS CAMPOS PARA CARTA DE SERVICIO (QF-VE008) ===
  ot: { type: String },                    // Orden de Trabajo
  item: { type: String },                  // Ítem del equipo
  noSerie: { type: String },               // Número de serie
  lugarServicio: { type: String },         // Lugar del servicio
  equipos: { type: String },               // Equipo(s) intervenido(s)
  trabajoRealizadoPor: { type: String },   // Técnico/empresa que realiza
  
  // Fecha desglosada
  fechaDia: { type: String },
  fechaMes: { type: String },
  fechaAnio: { type: String },
  
  // Descripción detallada del trabajo
  descripcionTrabajo: { type: String },
  
  // Firmas adicionales
  firmaCelcoNombre: { type: String },
  firmaCelcoCargo: { type: String },
  firmaClienteNombre: { type: String },
  firmaClienteCargo: { type: String },
  
  // Fotos (array de objetos)
  fotos: [{
    url: String,
    base64: String,
    nombre: String,
    mimetype: String,
    timestamp: { type: Date, default: Date.now }
  }],
  
  // Geolocalización
  ubicacion: {
    latitud: Number,
    longitud: Number,
    direccion: String,
    ciudad: String,
    pais: { type: String, default: 'Colombia' }
  },
  
  // Metadata del documento
  codigoDocumento: { type: String, default: 'QF-VE008' },
  versionDocumento: { type: String, default: '02' },
  fechaDocumento: { type: String, default: '2021/03/18' }
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

// === 🆕 NUEVO: Configuración de Multer para subir fotos ===
const multer = require('multer');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/fotos-servicio/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('Solo se permiten imágenes: JPG, JPEG, PNG, WEBP'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Crear carpeta de uploads si no existe
if (!fs.existsSync('uploads/fotos-servicio')) {
  fs.mkdirSync('uploads/fotos-servicio', { recursive: true });
}

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

// === 🆕 NUEVO: Generar PDF Carta de Servicio (Formato QF-VE008 - FINAL) ===
function generarCartaServicioPDF(datos) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4', autoFirstPage: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 30;
    const contentWidth = pageWidth - (margin * 2);
    
    let y = margin;

    // ==========================================
    // 1. ENCABEZADO
    // ==========================================
    // Izquierda: EELCO
    doc.fontSize(10).fillColor('#1565C0').font('Helvetica-Bold').text('EELCO', margin, y);
    doc.fontSize(6).fillColor('#666').font('Helvetica').text('Subestaciones - Switchgear - Tableros', margin, y + 10);
    
    // Centro: Título
    doc.fontSize(14).fillColor('#000').font('Helvetica-Bold').text('CARTA DE SERVICIO', pageWidth / 2, y + 5, { align: 'center' });
    
    // Derecha: Campos de Calidad
    doc.fontSize(7).fillColor('#000').font('Helvetica')
       .text(`CÓDIGO: ${datos.codigoDocumento || 'QF-VE008'}`, pageWidth - margin - 90, y, { align: 'right', width: 90 })
       .text(`VERSIÓN: ${datos.versionDocumento || '02'}`, pageWidth - margin - 90, y + 9, { align: 'right', width: 90 })
       .text(`FECHA: ${datos.fechaDocumento || '2021/03/18'}`, pageWidth - margin - 90, y + 18, { align: 'right', width: 90 });
    
    y += 32;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor('#1565C0').lineWidth(1.5).stroke();
    y += 15;

    // ==========================================
    // 2. DATOS PRINCIPALES
    // ==========================================
    doc.fontSize(8).fillColor('#000').font('Helvetica-Bold');
    
    // Fila 1
    doc.text('OT:', margin, y);
    doc.font('Helvetica').text(datos.ot || '__________', margin + 25, y, { width: 110 });
    
    doc.font('Helvetica-Bold').text('CLIENTE:', margin + 145, y);
    doc.font('Helvetica').text(datos.cliente || '__________', margin + 190, y, { width: 130 });
    
    doc.font('Helvetica-Bold').text('ITEM:', margin + 330, y);
    doc.font('Helvetica').text(datos.item || '__________', margin + 360, y, { width: 100 });
    
    y += 12;
    doc.font('Helvetica-Bold').text('No. DE SERIE:', margin + 330, y);
    doc.font('Helvetica').text(datos.noSerie || '__________', margin + 420, y, { width: 80 });
    
    y += 18;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor('#ccc').lineWidth(0.5).stroke();
    y += 12;

    // Fila 2
    doc.font('Helvetica-Bold').text('LUGAR DEL SERVICIO:', margin, y);
    doc.font('Helvetica').text(datos.lugarServicio || '__________', margin, y + 10, { width: 180 });
    
    doc.font('Helvetica-Bold').text('EQUIPO(S):', margin + 195, y);
    doc.font('Helvetica').text(datos.equipos || '__________', margin + 195, y + 10, { width: 150 });
    
    doc.font('Helvetica-Bold').text('TRABAJO REALIZADO POR:', margin + 355, y);
    doc.font('Helvetica').text(datos.trabajoRealizadoPor || '__________', margin + 355, y + 10, { width: 135 });
    
    y += 35;
    doc.moveTo(margin, y).lineTo(pageWidth - margin, y).strokeColor('#ccc').lineWidth(0.5).stroke();
    y += 12;

    // ==========================================
    // 3. PÁRRAFO LEGAL
    // ==========================================
    doc.fontSize(8).fillColor('#000').font('Helvetica');
    const parrafo = `La empresa ${datos.cliente || '_______'} hace constar que el día ${datos.fechaDia || '__'} del mes de ${datos.fechaMes || '_______'} del año 20${datos.fechaAnio || '__'}, recibió a entera satisfacción el servicio realizado por CELCO S.A.S, al equipo referenciado como: ${datos.item || '_______'}`;
    doc.text(parrafo, margin, y, { width: contentWidth, lineHeight: 1.2 });
    y += 25;

    // ==========================================
    // 4. DESCRIPCIÓN DEL TRABAJO
    // ==========================================
    doc.fontSize(9).font('Helvetica-Bold').text('El trabajo que se realizó fue el siguiente:', margin, y);
    y += 10;
    doc.fontSize(8).font('Helvetica').text(
      datos.descripcionTrabajo || datos.notas || 'Sin descripción',
      margin, y, { width: contentWidth, align: 'justify', lineHeight: 1.3 }
    );
    y += 20;

    // ==========================================
    // 5. FOTOS (Mejorado: Más espacio y manejo de errores)
    // ==========================================
    if (datos.fotos && datos.fotos.length > 0) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#1565C0').text('FOTOS DEL SERVICIO:', margin, y);
      y += 10;
      
      const fotosAMostrar = datos.fotos.slice(0, 4);
      const colWidth = (contentWidth / 2) - 10;
      let fotoIndex = 0;
      
      fotosAMostrar.forEach((foto, index) => {
        if (foto.base64) {
          try {
            let cleanBase64 = foto.base64;
            if (cleanBase64.includes('base64,')) cleanBase64 = cleanBase64.split('base64,')[1];
            
            const col = index % 2;
            const row = Math.floor(index / 2);
            const fotoX = margin + (col * (colWidth + 10));
            const fotoY = y + (row * 100); // Espacio más grande para las fotos
            
            const imgBuffer = Buffer.from(cleanBase64, 'base64');
            // Dibujar imagen sin 'fit' para forzar el tamaño exacto y asegurar que se vea
            doc.image(imgBuffer, fotoX, fotoY, { width: colWidth, height: 85 });
            doc.fontSize(7).fillColor('#666').font('Helvetica').text(
              foto.nombre || `Foto ${index + 1}`, 
              fotoX, 
              fotoY + 90, 
              { width: colWidth, align: 'center' }
            );
            fotoIndex++;
          } catch (err) { 
            console.error('❌ Error foto PDF:', err.message); 
          }
        }
      });
      
      // Si se procesaron fotos, avanzar el cursor Y
      if (fotoIndex > 0) {
        y += (Math.ceil(fotoIndex / 2) * 100) + 10;
      } else {
        y += 10; // Si fallaron, solo avanzamos un poco
      }
    }

    // ==========================================
    // 6. UBICACIÓN (Sin emojis)
    // ==========================================
    if (datos.ubicacion?.latitud) {
      doc.fontSize(8).fillColor('#666').font('Helvetica')
         .text(`Ubicación: ${datos.ubicacion.latitud}, ${datos.ubicacion.longitud}`, margin, y, { width: contentWidth });
      y += 12;
      if (datos.ubicacion.direccion) {
        doc.text(`Dirección: ${datos.ubicacion.direccion}`, margin, y, { width: contentWidth });
        y += 12;
      }
      if (datos.ubicacion.ciudad) {
        doc.text(`${datos.ubicacion.ciudad}, ${datos.ubicacion.pais || 'Colombia'}`, margin, y, { width: contentWidth });
        y += 15;
      }
    }

    // ==========================================
    // 7. FIRMAS (Compactas, forzadas al final)
    // ==========================================
    const footerSpace = 95;
    const pageBottom = pageHeight - margin;
    let signY = Math.max(y, pageBottom - footerSpace);
    
    doc.moveTo(margin, signY).lineTo(pageWidth - margin, signY).strokeColor('#1565C0').lineWidth(0.5).stroke();
    signY += 10;
    
    // CELCO
    doc.fontSize(8).fillColor('#000').font('Helvetica-Bold').text('En representación de CELCO S.A.S:', margin, signY);
    doc.fontSize(7).font('Helvetica').text(`Nombre: ${datos.firmaCelcoNombre || '__________'}`, margin, signY + 8);
    doc.text(`Cargo: ${datos.firmaCelcoCargo || '__________'}`, margin, signY + 16);
    doc.moveTo(margin, signY + 28).lineTo(margin + 180, signY + 28).strokeColor('#999').lineWidth(0.5).stroke();
    doc.fontSize(6).fillColor('#999').text('(Firma)', margin, signY + 32);
    
    // CLIENTE
    doc.fontSize(8).fillColor('#000').font('Helvetica-Bold').text('En representación del Cliente:', margin + 280, signY);
    doc.fontSize(7).font('Helvetica').text(`Nombre: ${datos.firmaClienteNombre || '__________'}`, margin + 280, signY + 8);
    doc.text(`Cargo: ${datos.firmaClienteCargo || '__________'}`, margin + 280, signY + 16);
    doc.moveTo(margin + 280, signY + 28).lineTo(margin + 460, signY + 28).strokeColor('#999').lineWidth(0.5).stroke();
    doc.fontSize(6).fillColor('#999').text('(Firma)', margin + 280, signY + 32);

    // ==========================================
    // 8. PIE DE PÁGINA ELIMINADO (Para evitar 3ra página y errores de corte)
    // ==========================================
    // Se eliminaron las líneas del footer para dejar el documento limpio hasta las firmas.

    doc.end();
  });
}

// 🔹 ENDPOINT: REGISTRO CON VERIFICACIÓN POR EMAIL (SIN CAMBIOS)
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
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
    
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    const user = new User({ 
      username, email, password,
      verificationToken, tokenExpires
    });
    await user.save();
    
    const verificationLink = `${process.env.RAILWAY_PUBLIC_DOMAIN || 'https://backend-formulario-production.up.railway.app'}/api/verify-email?token=${verificationToken}`;
    
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: "Celco S.A.S - Sistema", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: email, name: username }],
        subject: 'Verifica tu cuenta - Formulario Celco',
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #1565C0; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1>CELCO S.A.S</h1><p>Verificación de Cuenta</p>
            </div>
            <div style="background-color: #f5f5f5; padding: 30px; border-radius: 0 0 8px 8px;">
              <h2 style="color: #1565C0;">¡Bienvenido ${username}!</h2>
              <p>Para activar tu cuenta en el sistema de formularios, haz clic en el siguiente botón:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationLink}" style="background-color: #1565C0; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">VERIFICAR MI CUENTA</a>
              </div>
              <p style="color: #666; font-size: 14px;">O copia y pega este enlace en tu navegador:<br><a href="${verificationLink}">${verificationLink}</a></p>
              <p style="color: #999; font-size: 12px; margin-top: 30px;">Este enlace expira en 24 horas.<br>Si no solicitaste esta cuenta, ignora este email.</p>
            </div>
            <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;"><p>Celco S.A.S - Todos los derechos reservados</p></div>
          </div>
        `
      })
    });
    
    if (!brevoResponse.ok) {
      console.error('Error enviando email de verificación:', await brevoResponse.json());
    }
    
    res.json({ message: 'Registro exitoso. Revisa tu email corporativo @celco.com.co para verificar la cuenta.', email: email });
  } catch (error) {
    console.error('❌ Error registro:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// 🔹 ENDPOINT: VERIFICAR EMAIL (SIN CAMBIOS)
app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token no proporcionado' });
    
    const user = await User.findOne({
      verificationToken: token,
      tokenExpires: { $gt: new Date() },
      verified: false
    });
    
    if (!user) {
      return res.status(400).json({ error: 'Token inválido o expirado. Solicita un nuevo registro.' });
    }
    
    user.verified = true;
    user.verificationToken = undefined;
    user.tokenExpires = undefined;
    await user.save();
    
    res.send(`
      <!DOCTYPE html><html><head><title>Cuenta Verificada</title>
      <style>body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#1565C0 0%,#0D47A1 100%);display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.card{background:white;padding:40px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);text-align:center;max-width:400px}.icon{font-size:80px;margin-bottom:20px}h1{color:#1565C0;margin-bottom:10px}p{color:#666;margin-bottom:30px}.btn{background-color:#1565C0;color:white;padding:15px 40px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold}</style></head>
      <body><div class="card"><div class="icon">✅</div><h1>¡Cuenta Verificada!</h1><p>Tu cuenta de <strong>${user.username}</strong> ha sido activada exitosamente.</p><p>Ya puedes iniciar sesión en la aplicación móvil.</p></div></body></html>
    `);
  } catch (error) {
    console.error('Error verificando email:', error);
    res.status(500).json({ error: 'Error al verificar el email' });
  }
});

// 🔹 ENDPOINT: LOGIN (SIN CAMBIOS)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });
    
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });
    
    if (!user.verified) {
      return res.status(403).json({ error: 'Cuenta no verificada. Revisa tu email @celco.com.co y haz clic en el link de verificación.' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Contraseña incorrecta' });
    
    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || 'supersecreto123', { expiresIn: '7d' });
    
    res.json({ message: 'Login exitoso', token, username: user.username, email: user.email });
  } catch (error) {
    console.error('❌ Error login:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// === 🆕 NUEVO: Endpoint para subir fotos ===
app.post('/api/upload-fotos', authMiddleware, upload.array('fotos', 10), async (req, res) => {
  try {
    console.log('📸 Fotos recibidas:', req.files?.length || 0);
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron fotos' });
    }
    
    const fotosProcesadas = req.files.map(file => ({
      url: `/uploads/fotos-servicio/${file.filename}`,
      base64: fs.readFileSync(file.path).toString('base64'),
      nombre: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    }));
    
    // Eliminar archivos temporales
    req.files.forEach(file => {
      fs.unlink(file.path, (err) => {
        if (err) console.error('Error eliminando archivo temporal:', err);
      });
    });
    
    res.json({
      success: true,
      message: `${fotosProcesadas.length} foto(s) procesadas`,
      fotos: fotosProcesadas.map(f => ({
        nombre: f.nombre,
        size: f.size,
        preview: `${f.mimetype};base64,${f.base64.substring(0, 100)}...`
      }))
    });
    
  } catch (error) {
    console.error('❌ Error subiendo fotos:', error);
    res.status(500).json({ error: 'Error procesando las fotos' });
  }
});

// === 🆕 NUEVO: Endpoint para geolocalización inversa ===
app.get('/api/geocoding', authMiddleware, async (req, res) => {
  try {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
      return res.status(400).json({ error: 'Faltan parámetros lat y lon' });
    }
    
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`,
      { headers: { 'User-Agent': 'CelcoApp/1.0 (soporte@celco.com.co)' } }
    );
    
    const address = response.data.address;
    const direccion = {
      direccion_completa: response.data.display_name,
      ciudad: address.city || address.town || address.village || '',
      departamento: address.state || '',
      pais: address.country || 'Colombia',
      codigo_postal: address.postcode || ''
    };
    
    res.json({
      success: true,
      coordenadas: { lat: parseFloat(lat), lon: parseFloat(lon) },
      direccion: direccion
    });
    
  } catch (error) {
    console.error('❌ Error en geocoding:', error.message);
    res.json({
      success: true,
      coordenadas: { lat: parseFloat(req.query.lat), lon: parseFloat(req.query.lon) },
      direccion: { direccion_completa: 'Dirección no disponible' }
    });
  }
});

// 🔹 ENDPOINT PRINCIPAL - Recibir formulario (ACTUALIZADO CON COMPATIBILIDAD)
app.post('/api/formulario', authMiddleware, async (req, res) => {
  try {
    console.log('📩 Received:', req.body);
    
    const { cliente, trabajo, notas, email_destino, firma_base64, usuario,
            // === 🆕 NUEVOS CAMPOS ===
            ot, item, noSerie, lugarServicio, equipos, trabajoRealizadoPor,
            fechaDia, fechaMes, fechaAnio, descripcionTrabajo,
            firmaCelcoNombre, firmaCelcoCargo, firmaClienteNombre, firmaClienteCargo,
            fotos, ubicacion,
            codigoDocumento, versionDocumento, fechaDocumento
          } = req.body;
    
    const user = await User.findById(req.user.id);
    const nombreUsuario = user ? user.username : (usuario || 'admin');
    
    const count = await Submission.countDocuments();
    const numeroServicio = `SRV-${1001 + count}`;
    
    const fechaEnvio = new Date().toLocaleString('es-CO', { 
      timeZone: 'America/Bogota',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
    
    console.time('⏱️ 1. BD_Guardar');
    
    const submission = new Submission({
      numeroServicio, cliente, trabajo, notas, email_destino, firma_base64,
      usuario: nombreUsuario, usuarioId: user?._id, fechaEnvio, timestamp: new Date(), estado: 'pendiente',
      // === 🆕 NUEVOS CAMPOS ===
      ot, item, noSerie, lugarServicio, equipos, trabajoRealizadoPor,
      fechaDia, fechaMes, fechaAnio, descripcionTrabajo,
      firmaCelcoNombre, firmaCelcoCargo, firmaClienteNombre, firmaClienteCargo,
      fotos, ubicacion,
      codigoDocumento, versionDocumento, fechaDocumento
    });
    
    await submission.save();
    console.timeEnd('⏱️ 1. BD_Guardar');
    
    // === 🆕 DECIDIR QUÉ PDF GENERAR (Compatibilidad) ===
    console.time('⏱️ 2. PDF_Generar');
    let pdfBuffer;
    
    // Si hay campos del nuevo formato, usar Carta de Servicio
    if (ot || item || lugarServicio || descripcionTrabajo) {
      console.log('📄 Generando PDF: Carta de Servicio (QF-VE008)');
      pdfBuffer = await generarCartaServicioPDF({ 
        ...submission.toObject(), 
        fechaEnvio,
        // Asegurar que las fotos tengan base64 para el PDF
        fotos: fotos?.map(f => ({
          ...f,
          base64: f.base64?.replace(/^data:image\/[a-z]+;base64,/, '')
        }))
      });
    } else {
      // Usar formato original para compatibilidad
      console.log('📄 Generando PDF: Orden de Servicio (formato original)');
      pdfBuffer = await generarPDF({ ...submission.toObject(), fechaEnvio });
    }
    console.timeEnd('⏱️ 2. PDF_Generar');
    
    console.time('⏱️ 3. Brevo_Envio');
    
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: "Celco S.A.S", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: email_destino }],
        cc: [{ email: process.env.BREVO_SENDER_EMAIL }],
        subject: `${ot ? `OT ${ot} - ` : ''}${cliente ? `${cliente} - ` : ''}Servicio Técnico`,
        htmlContent: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #1565C0; color: white; padding: 20px; text-align: center;">
              <h1>CELCO S.A.S</h1>
              <h2>${ot ? `Orden de Trabajo #${ot}` : `Servicio #${numeroServicio}`}</h2>
            </div>
            <div style="padding: 20px; background-color: #f5f5f5;">
              <p><strong>Cliente:</strong> ${cliente}</p>
              <p><strong>Fecha:</strong> ${fechaEnvio}</p>
              <p><strong>Técnico:</strong> ${nombreUsuario}</p>
              ${lugarServicio ? `<p><strong>Lugar:</strong> ${lugarServicio}</p>` : ''}
              <div style="background-color: white; padding: 15px; border-left: 4px solid #1565C0; margin: 20px 0;">
                <p style="margin: 0;"><strong>Detalles:</strong></p>
                <p style="margin: 5px 0 0 0;">${descripcionTrabajo || notas || 'Sin detalles adicionales'}</p>
              </div>
            </div>
            <div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
              <p>Celco S.A.S - Servicio Técnico Especializado</p>
            </div>
          </div>
        `,
        attachment: [{ name: `Servicio_${numeroServicio}.pdf`, content: pdfBuffer.toString('base64') }]
      })
    });

    console.timeEnd('⏱️ 3. Brevo_Envio');

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

// 🔹 ENDPOINT: Estadísticas (SIN CAMBIOS)
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

// 🔹 ENDPOINT: Obtener todos los envíos (SIN CAMBIOS)
app.get('/api/submissions', authMiddleware, async (req, res) => {
  try {
    const lista = await Submission.find().sort({ timestamp: -1 }).select('numeroServicio cliente trabajo usuario fechaEnvio estado');
    res.json(lista);
  } catch (error) {
    console.error('❌ Error submissions:', error);
    res.status(500).json({ error: 'Error cargando envíos' });
  }
});

// 🔹 ENDPOINT: Obtener un envío específico (SIN CAMBIOS)
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
  // === 🆕 NUEVO: Log de endpoints agregados ===
  console.log(`📸 Fotos: POST /api/upload-fotos`);
  console.log(`🗺️ Geocoding: GET /api/geocoding`);
});