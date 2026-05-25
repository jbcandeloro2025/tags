/**
 * ============================================================
 * TAGS TRACKER - Servidor Principal (Express + Prisma + SQLite)
 * ============================================================
 * Sistema de rastreamento GPS em tempo real
 * Autor: Tags Tracker System
 * ============================================================
 */

'use strict';

// ─── Carregamento de Variáveis de Ambiente ─────────────────────────────────
require('dotenv').config();

// ─── Imports ───────────────────────────────────────────────────────────────
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

// ─── Configurações ──────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Garante que o diretório de dados existe (para o SQLite no Docker)
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`[INIT] Diretório de dados criado: ${dataDir}`);
}

if (!API_AUTH_TOKEN) {
  console.error('[FATAL] Variável de ambiente API_AUTH_TOKEN não definida!');
  process.exit(1);
}

// ─── Inicialização do Prisma ─────────────────────────────────────────────────
const prisma = new PrismaClient({
  log: NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// ─── Inicialização do Express ────────────────────────────────────────────────
const app = express();

// ─── Middlewares Globais ──────────────────────────────────────────────────────

// Segurança: Headers HTTP com Helmet
// Configuração relaxada para permitir Leaflet e Tailwind via CDN
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'cdn.tailwindcss.com',
          'unpkg.com',
          'cdn.jsdelivr.net',
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'cdn.tailwindcss.com',
          'unpkg.com',
          'cdn.jsdelivr.net',
          'fonts.googleapis.com',
        ],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          '*.tile.openstreetmap.org',
          'unpkg.com',
        ],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
        workerSrc: ["'self'", 'blob:'],
      },
    },
  })
);

// CORS
app.use(cors());

// Parse do corpo das requisições JSON
app.use(express.json({ limit: '1mb' }));

// Logger HTTP
app.use(morgan(NODE_ENV === 'development' ? 'dev' : 'combined'));

// ─── Rate Limiting ────────────────────────────────────────────────────────────

// Limiter geral para todas as rotas
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições, tente novamente mais tarde.' },
});

// Limiter específico para o endpoint de ingestão de dados
const postLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 120, // até 2 requisições por segundo por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit excedido para o endpoint de localização.' },
});

app.use('/api/', generalLimiter);

// ─── Middleware de Autenticação ───────────────────────────────────────────────

/**
 * Middleware que valida o Bearer Token nas rotas de mutação.
 * O token deve ser enviado no header: Authorization: Bearer <TOKEN>
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Não autorizado. Header "Authorization: Bearer <TOKEN>" obrigatório.',
    });
  }

  const token = authHeader.substring(7); // Remove "Bearer "

  if (token !== API_AUTH_TOKEN) {
    return res.status(403).json({ error: 'Token inválido.' });
  }

  next();
}

// ─── Middleware de Validação de Localização ───────────────────────────────────

/**
 * Valida o payload de localização recebido via POST.
 */
function validateLocation(req, res, next) {
  const { device_name, latitude, longitude, battery_level } = req.body;

  if (!device_name || typeof device_name !== 'string' || device_name.trim().length === 0) {
    return res.status(400).json({ error: 'Campo "device_name" é obrigatório e deve ser uma string não vazia.' });
  }

  if (device_name.trim().length > 100) {
    return res.status(400).json({ error: 'Campo "device_name" deve ter no máximo 100 caracteres.' });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  if (isNaN(lat) || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'Campo "latitude" deve ser um número entre -90 e 90.' });
  }

  if (isNaN(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Campo "longitude" deve ser um número entre -180 e 180.' });
  }

  if (battery_level !== undefined && battery_level !== null) {
    const bat = parseInt(battery_level, 10);
    if (isNaN(bat) || bat < 0 || bat > 100) {
      return res.status(400).json({ error: 'Campo "battery_level" deve ser um inteiro entre 0 e 100.' });
    }
    req.body.battery_level = bat;
  } else {
    req.body.battery_level = null;
  }

  // Normaliza os dados
  req.body.device_name = device_name.trim();
  req.body.latitude = lat;
  req.body.longitude = lng;

  next();
}

// ─── Rotas da API ─────────────────────────────────────────────────────────────

const router = express.Router();

/**
 * POST /api/location
 * Registra uma nova localização de um dispositivo.
 * Requer autenticação via Bearer Token.
 */
router.post('/location', postLimiter, requireAuth, validateLocation, async (req, res) => {
  try {
    const { device_name, latitude, longitude, battery_level } = req.body;

    const location = await prisma.location.create({
      data: {
        device_name,
        latitude,
        longitude,
        battery_level,
      },
    });

    console.log(`[TRACK] ${device_name} → (${latitude}, ${longitude}) bat:${battery_level ?? 'N/A'}%`);

    return res.status(201).json({
      success: true,
      id: location.id,
      message: 'Localização registrada com sucesso.',
    });
  } catch (error) {
    console.error('[ERROR] POST /api/location:', error);
    return res.status(500).json({ error: 'Erro interno ao salvar localização.' });
  }
});

/**
 * GET /api/location/latest
 * Retorna a última localização de cada dispositivo único.
 */
router.get('/location/latest', async (req, res) => {
  try {
    // Busca todos os device_names únicos
    const devices = await prisma.location.findMany({
      distinct: ['device_name'],
      orderBy: { created_at: 'desc' },
      select: { device_name: true },
    });

    // Para cada dispositivo, busca o registro mais recente
    const latestLocations = await Promise.all(
      devices.map(async ({ device_name }) => {
        return prisma.location.findFirst({
          where: { device_name },
          orderBy: { created_at: 'desc' },
        });
      })
    );

    return res.status(200).json({
      success: true,
      count: latestLocations.length,
      data: latestLocations,
    });
  } catch (error) {
    console.error('[ERROR] GET /api/location/latest:', error);
    return res.status(500).json({ error: 'Erro interno ao buscar localizações.' });
  }
});

/**
 * GET /api/location/history?device=NomeDispositivo&limit=50
 * Retorna o histórico de localizações de um dispositivo específico.
 */
router.get('/location/history', async (req, res) => {
  try {
    const { device, limit } = req.query;

    if (!device || typeof device !== 'string' || device.trim().length === 0) {
      return res.status(400).json({ error: 'Query param "device" é obrigatório.' });
    }

    const parsedLimit = Math.min(parseInt(limit || '50', 10), 500);

    if (isNaN(parsedLimit) || parsedLimit < 1) {
      return res.status(400).json({ error: 'Query param "limit" deve ser um número positivo.' });
    }

    const history = await prisma.location.findMany({
      where: { device_name: device.trim() },
      orderBy: { created_at: 'desc' },
      take: parsedLimit,
    });

    return res.status(200).json({
      success: true,
      device: device.trim(),
      count: history.length,
      data: history,
    });
  } catch (error) {
    console.error('[ERROR] GET /api/location/history:', error);
    return res.status(500).json({ error: 'Erro interno ao buscar histórico.' });
  }
});

/**
 * GET /api/location/devices
 * Retorna a lista de todos os dispositivos registrados.
 */
router.get('/location/devices', async (req, res) => {
  try {
    const devices = await prisma.location.findMany({
      distinct: ['device_name'],
      select: { device_name: true },
      orderBy: { device_name: 'asc' },
    });

    return res.status(200).json({
      success: true,
      data: devices.map((d) => d.device_name),
    });
  } catch (error) {
    console.error('[ERROR] GET /api/location/devices:', error);
    return res.status(500).json({ error: 'Erro interno ao listar dispositivos.' });
  }
});

/**
 * POST /api/location/clear
 * Limpa todo o histórico de localizações do banco de dados.
 * Requer autenticação via Bearer Token.
 */
router.post('/location/clear', requireAuth, async (req, res) => {
  try {
    const { device } = req.query;

    let deleted;

    if (device && typeof device === 'string' && device.trim().length > 0) {
      // Limpa apenas o histórico de um dispositivo específico
      deleted = await prisma.location.deleteMany({
        where: { device_name: device.trim() },
      });
      console.log(`[PURGE] Histórico limpo para dispositivo: ${device.trim()} (${deleted.count} registros)`);
    } else {
      // Limpa todo o histórico
      deleted = await prisma.location.deleteMany({});
      console.log(`[PURGE] Histórico completo limpo (${deleted.count} registros)`);
    }

    return res.status(200).json({
      success: true,
      deleted: deleted.count,
      message: device
        ? `Histórico do dispositivo "${device.trim()}" limpo com sucesso.`
        : 'Histórico completo limpo com sucesso.',
    });
  } catch (error) {
    console.error('[ERROR] POST /api/location/clear:', error);
    return res.status(500).json({ error: 'Erro interno ao limpar histórico.' });
  }
});

/**
 * GET /api/health
 * Health check endpoint para o Docker e Easypanel.
 */
router.get('/health', async (req, res) => {
  try {
    // Testa a conexão com o banco
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: require('./package.json').version,
    });
  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

/**
 * GET /api/stats
 * Estatísticas gerais do banco de dados.
 */
router.get('/stats', async (req, res) => {
  try {
    const totalLocations = await prisma.location.count();
    const totalDevices = await prisma.location.groupBy({
      by: ['device_name'],
    });

    const oldestRecord = await prisma.location.findFirst({
      orderBy: { created_at: 'asc' },
      select: { created_at: true },
    });

    return res.status(200).json({
      success: true,
      data: {
        total_locations: totalLocations,
        total_devices: totalDevices.length,
        oldest_record: oldestRecord?.created_at ?? null,
      },
    });
  } catch (error) {
    console.error('[ERROR] GET /api/stats:', error);
    return res.status(500).json({ error: 'Erro interno ao buscar estatísticas.' });
  }
});

// ─── Registro das Rotas ───────────────────────────────────────────────────────
app.use('/api', router);

// ─── Tratamento de Erros da API ───────────────────────────────────────────────

// Handler de erros genéricos da API (deve vir antes do static files)
app.use((err, req, res, _next) => {
  // Trata erros de parsing JSON (body-parser)
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
  }

  console.error('[ERROR] Erro não tratado:', err);
  return res.status(err.status || 500).json({ error: 'Erro interno do servidor.' });
});

// ─── Servir Arquivos Estáticos do Frontend ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: todas as rotas não capturadas pela API servem o index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Inicialização do Servidor ────────────────────────────────────────────────

async function startServer() {
  try {
    // Conecta ao banco de dados
    await prisma.$connect();
    console.log('[DB] Conexão com banco de dados estabelecida.');

    // Inicia o servidor HTTP
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('╔══════════════════════════════════════════╗');
      console.log('║         TAGS TRACKER - INICIADO          ║');
      console.log('╠══════════════════════════════════════════╣');
      console.log(`║  Ambiente: ${NODE_ENV.padEnd(30)}║`);
      console.log(`║  Porta:    ${String(PORT).padEnd(30)}║`);
      console.log(`║  Acesse:   http://localhost:${PORT.toString().padEnd(14)}║`);
      console.log('╚══════════════════════════════════════════╝');
      console.log('');
    });

    // ─── Graceful Shutdown ────────────────────────────────────────────────────
    const shutdown = async (signal) => {
      console.log(`\n[SHUTDOWN] Recebido sinal ${signal}. Encerrando graciosamente...`);

      server.close(async () => {
        await prisma.$disconnect();
        console.log('[SHUTDOWN] Servidor encerrado. Até mais!');
        process.exit(0);
      });

      // Força encerramento após 10 segundos
      setTimeout(() => {
        console.error('[SHUTDOWN] Forçando encerramento após timeout.');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('[FATAL] Falha ao iniciar o servidor:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Inicia!
startServer();
