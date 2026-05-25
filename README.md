# Tags Tracker 📍

Sistema web completo de rastreamento GPS em tempo real. Recebe coordenadas via API REST e exibe em um mapa interativo com histórico de rotas.

---

## ✨ Funcionalidades

- **Mapa interativo** com OpenStreetMap (Leaflet.js) — totalmente gratuito, sem API key
- **Tema dark** moderno com Tailwind CSS
- **Múltiplos dispositivos** rastreados simultaneamente com cores distintas
- **Atualização automática** a cada 30 segundos (polling silencioso)
- **Histórico de rotas** com polilinha no mapa ao clicar no dispositivo
- **Popups informativos** com nome, coordenadas, bateria e timestamp
- **Painel lateral** com lista de dispositivos e última atualização
- **Segurança** via Bearer Token em rotas de mutação
- **Rate limiting** contra abuso da API
- **SQLite** persistente via volume Docker

---

## 🚀 Rodando Localmente (Docker Desktop)

### 1. Configure o Token de Autenticação

Edite o arquivo `.env` e defina um token seguro:

```env
API_AUTH_TOKEN=seu-token-seguro-aqui-1234
```

### 2. Suba com Docker Compose

```bash
docker compose up --build -d
```

Acesse em: **http://localhost:3000**

### 3. Parar

```bash
docker compose down
```

> **Nota:** Os dados do SQLite são preservados no volume `tags_data` mesmo após parar o container.

---

## 🔧 Rodando sem Docker (Desenvolvimento)

```bash
# 1. Instale as dependências
npm install

# 2. Crie e aplique as migrations do banco
npx prisma migrate dev --name init

# 3. Inicie o servidor
npm start
# ou em modo watch:
npm run dev
```

---

## 📡 API REST

### Autenticação

As rotas de mutação (`POST`) exigem o header:
```
Authorization: Bearer <API_AUTH_TOKEN>
```

### Endpoints

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/api/location` | ✅ | Registra nova localização |
| `GET` | `/api/location/latest` | ❌ | Última posição de cada dispositivo |
| `GET` | `/api/location/history` | ❌ | Histórico de um dispositivo |
| `POST` | `/api/location/clear` | ✅ | Limpa o histórico |
| `GET` | `/api/health` | ❌ | Health check |
| `GET` | `/api/stats` | ❌ | Estatísticas gerais |

### Exemplos de Uso

**Registrar localização:**
```bash
curl -X POST http://localhost:3000/api/location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-token-aqui" \
  -d '{
    "device_name": "iPhone 11",
    "latitude": -25.5123,
    "longitude": -54.5812,
    "battery_level": 85
  }'
```

**Buscar últimas posições:**
```bash
curl http://localhost:3000/api/location/latest
```

**Histórico de um dispositivo:**
```bash
curl "http://localhost:3000/api/location/history?device=iPhone%2011&limit=50"
```

**Limpar histórico:**
```bash
curl -X POST http://localhost:3000/api/location/clear \
  -H "Authorization: Bearer seu-token-aqui"
```

### Payload de Localização

```json
{
  "device_name": "Nome do Dispositivo",
  "latitude": -25.5123,
  "longitude": -54.5812,
  "battery_level": 85
}
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `device_name` | String | ✅ | Nome único do dispositivo (max 100 chars) |
| `latitude` | Float | ✅ | Latitude (-90 a 90) |
| `longitude` | Float | ✅ | Longitude (-180 a 180) |
| `battery_level` | Integer | ❌ | Nível de bateria (0-100) |

---

## 🏗️ Estrutura do Projeto

```
tags/
├── server.js              # Servidor Express + API
├── package.json
├── Dockerfile             # Multi-stage build
├── docker-compose.yml     # Orquestração local
├── .env                   # Variáveis de ambiente (local)
├── .env.example           # Template das variáveis
├── prisma/
│   ├── schema.prisma      # Modelo do banco de dados
│   └── migrations/        # Histórico de migrations
├── public/
│   ├── index.html         # SPA com Tailwind + Leaflet
│   ├── app.js             # Lógica do frontend
│   └── style.css          # Customizações CSS
└── data/                  # SQLite database (gerado)
```

---

## 🌐 Deploy no Easypanel

1. Crie um novo serviço no Easypanel apontando para este repositório
2. Configure as variáveis de ambiente:
   - `API_AUTH_TOKEN` → token seguro
   - `DATABASE_URL` → `file:./data/tracking.db`
   - `PORT` → `3000`
3. Configure um volume em `/app/data` para persistência do banco
4. O Dockerfile irá rodar as migrations automaticamente no boot

---

## 🔒 Segurança

- **Bearer Token** obrigatório em todas as rotas de escrita
- **Rate limiting**: 500 req/15min geral, 120 req/min no endpoint de ingestão
- **Helmet.js** com Content Security Policy configurada
- **Validação** de todos os campos do payload
- **Usuário não-root** no container Docker

---

## 📱 Integração com Smartphone (Automação)

Configure sua automação (Shortcuts, Tasker, etc.) para enviar `POST /api/location` periodicamente com as coordenadas do GPS do dispositivo.

**Exemplo com iOS Shortcuts:**
- Ação: "Obter localização atual"
- Ação: "Obter conteúdo da URL" → POST para `http://seu-servidor:3000/api/location` com o JSON de localização
