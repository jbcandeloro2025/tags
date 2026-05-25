PROMPT DE DESENVOLVIMENTO: SISTEMA WEB DE RASTREAMENTO
Contexto: Preciso de um sistema web completo (Backend + Frontend) contido em uma única aplicação Node.js para ser deployado via Docker/Easypanel. O objetivo é receber coordenadas geográficas via requisições HTTP POST vindas de uma automação de smartphone e renderizá-las em um painel web com mapa interativo e histórico.

OBS: a principio vamso desenvolver localmente usando o docker desktop


1. Stack Tecnológica & Infraestrutura
Ambiente: Node.js (com Express)

Banco de Dados: SQLite (pela simplicidade de arquivo único no volume do Docker) ou PostgreSQL. [Nota: Escreva o código usando Prisma ORM para facilitar a troca, mas configure inicialmente para SQLite].

Frontend: HTML5, CSS3 (Tailwind CSS via CDN) e JavaScript Vanilla (ES6+).

Mapas: Leaflet.js (OpenStreetMap) — totalmente gratuito, sem necessidade de chaves de API.

2. Especificação do Backend (API Rest)
O backend deve ser estruturado em Express e conter os seguintes endpoints e regras de segurança:

Segurança (Middleware)
Todas as rotas de mutação (POST, DELETE) devem exigir um Header customizado: Authorization: Bearer <TOKEN_SECRETO>.

O <TOKEN_SECRETO> deve ser lido de uma variável de ambiente API_AUTH_TOKEN.

Modelagem do Banco de Dados (Prisma Schema ou SQL puro)
A tabela locations deve conter:

id (String/UUID ou Auto-increment)

device_name (String, ex: "iPhone 11", "AirTag Chave")

latitude (Float / Float8)

longitude (Float / Float8)

battery_level (Integer, opcional, padrão null)

created_at (Datetime, padrão NOW())

Endpoints da API
POST /api/location

Payload esperado (JSON):

JSON
{
  "device_name": "Nome do Dispositivo",
  "latitude": -25.5123,
  "longitude": -54.5812,
  "battery_level": 85
}
    *   **Ação:** Validar se os dados são válidos, injetar o timestamp atual e salvar no banco de dados. Retornar `201 Created`.

*   **`GET /api/location/latest`**
    *   **Ação:** Retornar a última localização registrada de cada `device_name` único.
    *   **Resposta:** Array de objetos com as coordenadas mais recentes.

*   **`GET /api/location/history?device=Nome&limit=50`**
    *   **Ação:** Retornar os últimos X registros de um dispositivo específico para plotagem de rota histórica.

*   **`POST /api/location/clear`**
    *   **Ação:** Limpar o histórico de localizações (mecanismo de purga do banco).

---

## 3. Especificação do Frontend (Painel Web)

O frontend deve ser servido como arquivos estáticos pelo próprio Express (`app.use(express.static('public'))`). Toda a interface deve estar contida em uma SPA (Single Page Application) simples e responsiva.

### Interface Visual (UI com Tailwind)
*   **Layout:** Dashboard moderno e dark mode nativo (fundo grafite/escuro).
*   **Header:** Título do sistema, indicador de status da API e um botão discreto para "Limpar Histórico".
*   **Sidebar/Painel Lateral:** Lista dos dispositivos cadastrados com o nome, nível de bateria (se houver) e o timestamp relativo da última atualização (ex: "Há 5 min").
*   **Área Principal:** Um container full-screen ou responsivo que renderiza o mapa do **Leaflet.js**.

### Comportamento do JavaScript (Client-side)
*   Ao carregar a página, fazer um fetch em `/api/location/latest` para plotar os marcadores (pins) atuais de cada dispositivo no mapa.
*   Implementar um `setInterval` para atualizar as posições silenciosamente no mapa a cada 30 segundos (Polling).
*   Ao clicar em um dispositivo na lista lateral, o mapa deve centralizar (`map.setView`) nas coordenadas dele e desenhar uma linha (`L.polyline`) mostrando o histórico recente de posições obtido de `/api/location/history`.
*   Os marcadores no mapa devem abrir um popup ao serem clicados, mostrando o nome do dispositivo, coordenadas exatas e a hora exata da captura.

---

## 4. Estrutura de Arquivos do Projeto
Gere o código organizando os arquivos da seguinte forma:
```text
├── package.json
├── server.js            # Código do servidor Express e conexões de rotas
├── prisma/              # Caso opte por ORM (opcional, pode ser sqlite3 direto)
│   └── schema.prisma
└── public/              # Pasta do Frontend
    ├── index.html       # Estrutura HTML com Tailwind e Leaflet injetados via CDN
    ├── app.js           # Lógica do mapa, fetchs e manipulação de DOM
    └── style.css        # Customizações pontuais de CSS para o Leaflet
5. Instruções para o Dockerfile (Foco no Easypanel)
Gere um Dockerfile multi-stage padrão para Node.js que:

Instale as dependências de produção.

Exponha a porta 3000.

Defina um volume em /app/data caso use o SQLite para garantir que o banco de dados não seja apagado a cada novo deploy no Easypanel.

Resultado Esperado: Forneça o código limpo, comentado, pronto para produção, sem dependências complexas de compilação, focando em performance e legibilidade.