require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Base de datos EN MEMORIA (para producción usa MongoDB/PostgreSQL)
const submissions = [];
let serviceCounter = 1000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Configurar transporte de email
const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SENDER_EMAIL,
    pass: process.env.BREVO_API_KEY,
  },
});

// 🔹 GENERAR PDF PROFESIONAL
function generarPDF(datos) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ 
      margin: 40,
      size: 'A4'
    });
    
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    // HEADER CON COLOR CORPORATIVO
    doc.rect(0, 0, 595, 120)
       .fill('#1565C0');
    
    // Logo (si existe en base64, sino solo texto)
    doc.fontSize(28)
       .fillColor('#FFFFFF')
       .font('Helvetica-Bold')
       .text('CELCO S.A.S.', 120, 30, { align: 'left' });
    
    doc.fontSize(12)
       .fillColor('#FFFFFF')
       .font('Helvetica')
       .text('Servicio Técnico Especializado', 120, 55, { align: 'left' });
    
    // Número de servicio
    doc.fontSize(16)
       .fillColor('#FFFFFF')
       .font('Helvetica-Bold')
       .text(`ORDEN DE SERVICIO #${datos.numeroServicio}`, 120, 80, { align: 'left' });
    
    // Fecha y técnico
    doc.fontSize(10)
       .fillColor('#E3F2FD')
       .text(`Fecha: ${datos.fechaEnvio}`, 120, 100)
       .text(`Técnico: ${datos.usuario || 'No registrado'}`, 120, 112);
    
    // INFORMACIÓN DEL CLIENTE
    doc.moveDown(2)
       .fontSize(14)
       .fillColor('#1565C0')
       .font('Helvetica-Bold')
       .text('INFORMACIÓN DEL CLIENTE', 40, 140);
    
    doc.fontSize(11)
       .fillColor('#333333')
       .font('Helvetica')
       .text(`Cliente: ${datos.cliente}`, 40, 165)
       .text(`Email: ${datos.email_destino}`, 40, 180)
       .text(`Trabajo Solicitado: ${datos.trabajo}`, 40, 195);
    
    // DETALLES DEL SERVICIO
    doc.moveDown(0.5)
       .fontSize(14)
       .fillColor('#1565C0')
       .font('Helvetica-Bold')
       .text('DETALLES DEL SERVICIO', 40, 220);
    
    doc.fontSize(11)
       .fillColor('#333333')
       .font('Helvetica')
       .text(datos.notas || 'Sin notas adicionales', 40, 245, {
         width: 515,
         align: 'left',
         lineHeight: 1.6
       });
    
    // FIRMA
    if (datos.firma_base64) {
      const firmaData = datos.firma_base64.replace(/^image\/png;base64,/, '');
      const signaturePath = path.join(__dirname, 'temp_signature.png');
      
      try {
        fs.writeFileSync(signaturePath, firmaData, 'base64');
        
        doc.fontSize(11)
           .fillColor('#1565C0')
           .font('Helvetica-Bold')
           .text('FIRMA DEL CLIENTE', 40, 340);
        
        doc.image(signaturePath, 40, 360, { 
          width: 200,
          align: 'left'
        });
        
        // Limpiar archivo temporal
        setTimeout(() => fs.unlinkSync(signaturePath), 1000);
      } catch (err) {
        console.error('Error con la firma:', err);
      }
    }
    
    // FOOTER
    const pageHeight = doc.page.height;
    doc.fontSize(9)
       .fillColor('#999999')
       .font('Helvetica')
       .text('Celco S.A.S. - Todos los derechos reservados', 40, pageHeight - 40, {
         align: 'center',
         width: 515
       })
       .text('Documento generado electrónicamente', 40, pageHeight - 28, {
         align: 'center',
         width: 515
       });
    
    doc.end();
  });
}

// 🔹 ENDPOINT PRINCIPAL - Recibir formulario
app.post('/api/formulario', async (req, res) => {
  try {
    console.log('📩 Received:', req.body);
    
    const { cliente, trabajo, notas, email_destino, firma_base64, usuario } = req.body;
    
    // Generar número de servicio único
    const numeroServicio = `SRV-${++serviceCounter}`;
    const fechaEnvio = new Date().toLocaleString('es-CO', { 
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    // Guardar en "base de datos"
    const submission = {
      id: submissions.length + 1,
      numeroServicio,
      cliente,
      trabajo,
      notas,
      email_destino,
      firma_base64,
      usuario: usuario || 'admin',
      fechaEnvio,
      timestamp: new Date(),
      estado: 'pendiente'
    };
    
    submissions.push(submission);
    
    // Generar PDF
    const pdfBuffer = await generarPDF({
      ...submission,
      fechaEnvio
    });
    
    // Enviar email
    await transporter.sendMail({
      from: `"Celco S.A.S" <${process.env.BREVO_SENDER_EMAIL}>`,
      to: email_destino,
      cc: process.env.BREVO_SENDER_EMAIL,
      subject: `Orden de Servicio #${numeroServicio} - ${cliente}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #1565C0; color: white; padding: 20px; text-align: center;">
            <h1>CELCO S.A.S</h1>
            <h2>Orden de Servicio #${numeroServicio}</h2>
          </div>
          
          <div style="padding: 20px; background-color: #f5f5f5;">
            <h3 style="color: #1565C0;">Detalles del Servicio</h3>
            <p><strong>Cliente:</strong> ${cliente}</p>
            <p><strong>Trabajo:</strong> ${trabajo}</p>
            <p><strong>Fecha:</strong> ${fechaEnvio}</p>
            <p><strong>Técnico:</strong> ${usuario || 'No registrado'}</p>
            
            <div style="background-color: white; padding: 15px; border-left: 4px solid #1565C0; margin: 20px 0;">
              <p style="margin: 0;"><strong>Notas:</strong></p>
              <p style="margin: 5px 0 0 0;">${notas || 'Sin notas adicionales'}</p>
            </div>
          </div>
          
          <div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
            <p>Celco S.A.S - Servicio Técnico Especializado</p>
            <p>Documento generado automáticamente</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `Orden_${numeroServicio}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });
    
    submission.estado = 'enviado';
    console.log('✅ Email enviado con éxito');
    
    res.json({ 
      success: true, 
      message: 'Formulario enviado correctamente',
      numeroServicio 
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 🔹 ENDPOINT: Obtener estadísticas (Dashboard)
app.get('/api/stats', (req, res) => {
  const ahora = new Date();
  
  // Estadísticas generales
  const total = submissions.length;
  const enviados = submissions.filter(s => s.estado === 'enviado').length;
  const pendientes = submissions.filter(s => s.estado === 'pendiente').length;
  
  // Últimos 7 días
  const hace7Dias = new Date(ahora - 7 * 24 * 60 * 60 * 1000);
  const ultimos7Dias = submissions.filter(s => s.timestamp >= hace7Dias).length;
  
  // Este mes
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const esteMes = submissions.filter(s => s.timestamp >= inicioMes).length;
  
  // Por técnico
  const porTecnico = {};
  submissions.forEach(s => {
    const tecnico = s.usuario || 'Sin asignar';
    porTecnico[tecnico] = (porTecnico[tecnico] || 0) + 1;
  });
  
  // Últimos envíos
  const ultimosEnvios = submissions
    .slice(-10)
    .reverse()
    .map(s => ({
      numeroServicio: s.numeroServicio,
      cliente: s.cliente,
      fecha: s.fechaEnvio,
      tecnico: s.usuario,
      estado: s.estado
    }));
  
  res.json({
    resumen: {
      total,
      enviados,
      pendientes,
      ultimos7Dias,
      esteMes
    },
    porTecnico,
    ultimosEnvios
  });
});

// 🔹 ENDPOINT: Obtener todos los envíos (para lista detallada)
app.get('/api/submissions', (req, res) => {
  const lista = submissions.map(s => ({
    id: s.id,
    numeroServicio: s.numeroServicio,
    cliente: s.cliente,
    trabajo: s.trabajo,
    usuario: s.usuario,
    fechaEnvio: s.fechaEnvio,
    estado: s.estado
  })).reverse();
  
  res.json(lista);
});

// 🔹 ENDPOINT: Obtener un envío específico
app.get('/api/submissions/:id', (req, res) => {
  const submission = submissions.find(s => s.id === parseInt(req.params.id));
  
  if (!submission) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  
  res.json(submission);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
});