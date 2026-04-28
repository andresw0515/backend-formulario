const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
  numeroServicio: { type: String, required: true },
  cliente: String,
  trabajo: String,
  notas: String,
  email_destino: String,
  firma_base64: String,
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  usuarioNombre: String,
  fechaEnvio: String,
  estado: { type: String, default: 'enviado' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Submission', SubmissionSchema);