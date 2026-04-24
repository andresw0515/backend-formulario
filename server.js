require('dotenv').config();
const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Permite recibir firmas en base64

// 🟢 Health check (para verificar que el servidor está activo)
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 📝 Endpoint principal
app.post('/api/formulario', async (req, res) => {
  try {
    const { cliente, trabajo, notas, email_destino, firma_base64 } = req.body;

    // 1️⃣ Validación básica
    if (!cliente || !trabajo || !email_destino || !firma_base64) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (cliente, trabajo, email, firma)' });
    }

    // 2️⃣ Generar PDF en memoria
    const pdfBuffer = await generarPDF({ cliente, trabajo, notas, firma_base64 });

    // 3️⃣ Enviar correo con Brevo (adjunto real)
    const brevoResponse = await enviarCorreoBrevo({
      to: email_destino,
      cliente,
      trabajo,
      pdfBuffer
    });

    // 4️⃣ Respuesta exitosa
    res.json({
      success: true,
      message: 'Formulario procesado y correo enviado',
      brevo_message_id: brevoResponse.data.messageId
    });

  } catch (error) {
    console.error('❌ Error en /api/formulario:', error.response?.data || error.message);
    const status = error.response?.status || 500;
    res.status(status).json({
      error: error.response?.data?.message || 'Error interno del servidor'
    });
  }
});

// 🔧 Función: Generar PDF
function generarPDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(22).text('FORMULARIO DE TRABAJO EXTERNO', { align: 'center', bold: true });
    doc.moveDown();
    doc.fontSize(12).text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`);
    doc.text(`Cliente: ${data.cliente}`);
    doc.text(`Trabajo: ${data.trabajo}`);
    doc.text(`Notas: ${data.notas || 'Sin observaciones'}`);
    doc.moveDown();
    doc.text('FIRMA DEL CLIENTE:', { bold: true });
    
    // Limpiar data URI si viene con prefijo
    const b64Raw = data.firma_base64.includes(',') 
      ? data.firma_base64.split(',')[1] 
      : data.firma_base64;
      
    doc.image(Buffer.from(b64Raw, 'base64'), { fit: [250, 120], align: 'center' });
    doc.end();
  });
}

// 🔧 Función: Enviar con Brevo API
async function enviarCorreoBrevo({ to, cliente, trabajo, pdfBuffer }) {
  const payload = {
    sender: { email: process.env.BREVO_SENDER_EMAIL, name: 'Trabajo Externo' },
    to: [{ email: to }],
    subject: `✅ Formulario firmado: ${trabajo}`,
    htmlContent: `<p>Hola <strong>${cliente}</strong>,<br>Adjunto encontrarás el formulario completado y firmado digitalmente.</p><p>Saludos,<br>Equipo de Campo</p>`,
    attachment: [{ name: `formulario_${Date.now()}.pdf`, content: pdfBuffer.toString('base64') }]
  };

  return await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    }
  });
}

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Backend corriendo en http://localhost:${PORT}`));