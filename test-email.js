require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_SENDER_EMAIL,
    pass: process.env.BREVO_API_KEY,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Error de conexión:', error);
  } else {
    console.log('✅ Servidor listo para enviar correos');
  }
});