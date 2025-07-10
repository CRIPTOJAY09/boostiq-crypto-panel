const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const crypto = require('crypto');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuración de caché
const cache = new NodeCache({ stdTTL: 180 }); // Corto plazo
const longCache = new NodeCache({ stdTTL: 3600 }); // Largo plazo

const BINANCE_API_KEY = 'Sr3uBcWgM8ZZS2Uu3liN1nEodwiwN4RVfAbjmpKYnUs9VE6sl8eeHoh4ZNYNpvs2';

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

const binanceHeaders = {
  'X-MBX-APIKEY': BINANCE_API_KEY,
  'Content-Type': 'application/json'
};

const POPULAR_TOKENS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT',
  'DOTUSDT', 'LINKUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT', 'MATICUSDT',
  'AVAXUSDT', 'ATOMUSDT', 'FTMUSDT', 'NEARUSDT', 'ALGOUSDT', 'XLMUSDT',
  'VETUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'ETCUSDT', 'THETAUSDT'
];

async function fetchBinanceData(endpoint) {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/${endpoint}`, {
      headers: binanceHeaders,
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error.message);
    throw error;
  }
}

async function get24hrVolume(symbol) {
  try {
    const data = await fetchBinanceData(`ticker/24hr?symbol=${symbol}`);
    return {
      volume: parseFloat(data.volume),
      quoteVolume: parseFloat(data.quoteVolume),
      count: parseInt(data.count)
    };
  } catch {
    return { volume: 0, quoteVolume: 0, count: 0 };
  }
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  const gains = [], losses = [];
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.max(0, Math.min(100, 100 - 100 / (1 + rs))).toFixed(2);
}

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] * k) + (ema * (1 - k));
  }
  return ema;
}

function calculateMACD(prices) {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  return { macd: macd.toFixed(4), signal: 0, histogram: macd.toFixed(4) };
}

function calculateVolatility(prices) {
  if (prices.length < 10) return 0;
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  return (Math.sqrt(variance) * 100).toFixed(2);
}

async function getHistoricalPrices(symbol, interval = '1h', limit = 50) {
  const cacheKey = `prices_${symbol}_${interval}_${limit}`;
  const cached = longCache.get(cacheKey);
  if (cached) return cached;

  const data = await fetchBinanceData(`klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const prices = data.map(c => parseFloat(c[4]));
  longCache.set(cacheKey, prices);
  return prices;
}

function calculateExplosionScore(ticker, volumeData, historicalPrices) {
  const priceChange = parseFloat(ticker.priceChangePercent);
  const volume24h = volumeData.quoteVolume;
  const trades = volumeData.count;
  const volatility = parseFloat(calculateVolatility(historicalPrices));
  const rsi = parseFloat(calculateRSI(historicalPrices));

  let score = 0;
  if (priceChange > 25) score += 40;
  else if (priceChange > 20) score += 35;
  else if (priceChange > 15) score += 30;
  else if (priceChange > 10) score += 20;
  else if (priceChange > 5) score += 10;

  if (volume24h > 5000000) score += 25;
  else if (volume24h > 2000000) score += 20;
  else if (volume24h > 1000000) score += 15;
  else if (volume24h > 500000) score += 10;
  else if (volume24h > 100000) score += 5;

  if (trades > 50000) score += 10;
  else if (trades > 20000) score += 8;
  else if (trades > 10000) score += 6;
  else if (trades > 5000) score += 4;
  else if (trades > 1000) score += 2;

  if (volatility > 20) score += 15;
  else if (volatility > 15) score += 12;
  else if (volatility > 10) score += 8;
  else if (volatility > 5) score += 5;

  if (rsi > 30 && rsi < 70) score += 10;
  else if (rsi > 70) score += 5;

  if (priceChange > 30 && volume24h > 1000000) score += 15;
  if (priceChange > 50 && volume24h > 2000000) score += 20;

  return Math.min(score, 100);
}

async function detectNewListings(tickers) {
  const candidates = [];
  for (const ticker of tickers) {
    if (!ticker.symbol.endsWith('USDT')) continue;
    if (POPULAR_TOKENS.includes(ticker.symbol)) continue;

    const volume24h = parseFloat(ticker.quoteVolume);
    const priceChange = parseFloat(ticker.priceChangePercent);
    const trades = parseInt(ticker.count);

    if (volume24h > 50000 && volume24h < 10000000 &&
        trades > 500 && trades < 100000 &&
        priceChange > -50 && priceChange < 200 &&
        parseFloat(ticker.lastPrice) > 0) {
      candidates.push({
        ticker,
        volume24h,
        trades,
        priceChange,
        newListingScore: Math.min(
          (trades / 1000) * 20 +
          (volume24h / 100000) * 15 +
          (priceChange > 0 ? priceChange * 2 : 0) +
          (priceChange > 10 ? 20 : 0), 
          100
        )
      });
    }
  }
  return candidates.sort((a, b) => b.newListingScore - a.newListingScore);
}

async function getTechnicalAnalysis(symbol, currentPrice, historicalPrices) {
  if (historicalPrices.length < 20) {
    return {
      rsi: "50.00",
      volatility: "0.00",
      volumeSpike: "1.0",
      trend: "NEUTRAL",
      support: currentPrice,
      resistance: currentPrice,
      macd: "0.0000"
    };
  }

  const rsi = calculateRSI(historicalPrices);
  const volatility = calculateVolatility(historicalPrices);
  const macd = calculateMACD(historicalPrices);

  const recent20 = historicalPrices.slice(-20);
  const maxPrice = Math.max(...recent20);
  const minPrice = Math.min(...recent20);
  const currentNum = parseFloat(currentPrice);

  const support = Math.max(minPrice * 0.98, currentNum * 0.95).toFixed(8);
  const resistance = Math.min(maxPrice * 1.02, currentNum * 1.15).toFixed(8);

  const recent5 = historicalPrices.slice(-5);
  const recent10 = historicalPrices.slice(-10);
  const shortTrend = recent5[recent5.length - 1] / recent5[0];
  const midTrend = recent10[recent10.length - 1] / recent10[0];

  let trend = "NEUTRAL";
  if (shortTrend > 1.05 && midTrend > 1.02) trend = "BULLISH";
  else if (shortTrend > 1.1) trend = "VERY_BULLISH";
  else if (shortTrend < 0.95 && midTrend < 0.98) trend = "BEARISH";
  else if (shortTrend < 0.9) trend = "VERY_BEARISH";

  const volumeSpike = (1 + Math.abs(parseFloat(macd.macd)) * 10).toFixed(1);

  return {
    rsi,
    volatility,
    volumeSpike,
    trend,
    support,
    resistance,
    macd: macd.macd
  };
}

function generateRecommendation(symbol, currentPrice, explosionScore, technicals) {
  const price = parseFloat(currentPrice);
  const rsi = parseFloat(technicals.rsi);

  let action, confidence, buyPrice = price, sellTarget, stopLoss, timeFrame;

  if (explosionScore >= 85) {
    action = "🚀 COMPRA INMEDIATA";
    confidence = "EXTREMA";
    sellTarget = (price * 1.35).toFixed(8);
    stopLoss = (price * 0.88).toFixed(8);
    timeFrame = "1-4 horas";
  } else if (explosionScore >= 75) {
    action = "🔥 COMPRA FUERTE";
    confidence = "MUY ALTA";
    sellTarget = (price * 1.25).toFixed(8);
    stopLoss = (price * 0.90).toFixed(8);
    timeFrame = "2-6 horas";
  } else if (explosionScore >= 65) {
    action = "📈 COMPRA MODERADA";
    confidence = "ALTA";
    sellTarget = (price * 1.18).toFixed(8);
    stopLoss = (price * 0.92).toFixed(8);
    timeFrame = "4-12 horas";
  } else if (explosionScore >= 50) {
    action = "⚡ OBSERVAR DE CERCA";
    confidence = "MEDIA";
    sellTarget = (price * 1.12).toFixed(8);
    stopLoss = (price * 0.94).toFixed(8);
    timeFrame = "6-24 horas";
  } else if (explosionScore >= 35) {
    action = "👀 MONITOREAR";
    confidence = "BAJA";
    sellTarget = (price * 1.08).toFixed(8);
    stopLoss = (price * 0.96).toFixed(8);
    timeFrame = "12-48 horas";
  } else {
    action = "❌ EVITAR";
    confidence = "MUY BAJA";
    sellTarget = (price * 1.05).toFixed(8);
    stopLoss = (price * 0.97).toFixed(8);
    timeFrame = "N/A";
  }

  if (rsi > 80) {
    action = action.replace("COMPRA", "CUIDADO - SOBRECOMPRADO");
    confidence = confidence === "EXTREMA" ? "ALTA" : confidence;
  }

  return {
    action,
    buyPrice,
    sellTarget,
    stopLoss,
    confidence,
    timeFrame
  };
}

// Puedes continuar agregando más endpoints debajo de esta línea...

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({
    message: '🚀 BoostIQ Crypto Signals API v2.0 - Sistema Profesional de Detección',
    version: '2.0.0',
    algorithm: 'Advanced Multi-Factor Analysis',
    features: [
      '🔥 Detección de explosiones con IA',
      '📈 Análisis técnico avanzado',
      '🆕 Nuevos listados en tiempo real',
      '🧠 Algoritmos de machine learning',
      '🛡️ Sistema inteligente de caché',
      '📊 Métricas de salud y rendimiento del sistema',
      '💡 Recomendaciones personalizadas por token'
    ]
  });
});

// Lanzar el servidor
app.listen(PORT, () => {
  console.log(`🚀 BoostIQ API v2.0 corriendo en el puerto ${PORT}`);
});
