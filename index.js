const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const axios = require('axios');
const crypto = require('crypto');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 8080;

// Configuración de cache (5 minutos)
const cache = new NodeCache({ stdTTL: 300 });

// Tu API Key de Binance
const BINANCE_API_KEY = 'Sr3uBcWgM8ZZS2Uu3liN1nEodwiwN4RVfAbjmpKYnUs9VE6sl8eeHoh4ZNYNpvs2';
const BINANCE_SECRET = ''; // Agregar si tienes secret key

// Middlewares
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// Headers para Binance
const binanceHeaders = {
  'X-MBX-APIKEY': BINANCE_API_KEY,
  'Content-Type': 'application/json'
};

// Función para obtener datos de Binance
async function fetchBinanceData(endpoint) {
  try {
    const response = await axios.get(`https://api.binance.com/api/v3/${endpoint}`, {
      headers: binanceHeaders
    });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error.message);
    throw error;
  }
}

// Función para calcular RSI
function calculateRSI(prices, period = 14) {
  if (prices.length < period) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi.toFixed(2);
}

// Función para calcular volatilidad
function calculateVolatility(prices) {
  if (prices.length < 2) return 0;
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  
  return (Math.sqrt(variance) * 100).toFixed(2);
}

// Función para obtener precios históricos
async function getHistoricalPrices(symbol, interval = '1h', limit = 24) {
  try {
    const data = await fetchBinanceData(`klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return data.map(candle => parseFloat(candle[4])); // Precio de cierre
  } catch (error) {
    return [];
  }
}

// Función para calcular explosion score
function calculateExplosionScore(ticker, volume24h, historicalPrices) {
  const priceChange = parseFloat(ticker.priceChangePercent);
  const volume = parseFloat(volume24h);
  const volatility = parseFloat(calculateVolatility(historicalPrices));
  
  let score = 0;
  
  // Puntuación por cambio de precio
  if (priceChange > 15) score += 40;
  else if (priceChange > 8) score += 25;
  else if (priceChange > 5) score += 15;
  
  // Puntuación por volumen
  if (volume > 1000000) score += 25;
  else if (volume > 500000) score += 15;
  else if (volume > 100000) score += 10;
  
  // Puntuación por volatilidad
  if (volatility > 15) score += 20;
  else if (volatility > 10) score += 15;
  else if (volatility > 5) score += 10;
  
  // Bonus por momentum
  if (priceChange > 20 && volume > 500000) score += 15;
  
  return Math.min(score, 100);
}

// Función para obtener análisis técnico completo
async function getTechnicalAnalysis(symbol, currentPrice, historicalPrices) {
  const rsi = calculateRSI(historicalPrices);
  const volatility = calculateVolatility(historicalPrices);
  const priceNum = parseFloat(currentPrice);
  
  // Calcular soporte y resistencia
  const maxPrice = Math.max(...historicalPrices);
  const minPrice = Math.min(...historicalPrices);
  const support = (minPrice * 1.02).toFixed(8);
  const resistance = (maxPrice * 0.98).toFixed(8);
  
  // Determinar tendencia
  const recentPrices = historicalPrices.slice(-5);
  const trend = recentPrices[recentPrices.length - 1] > recentPrices[0] ? 'BULLISH' : 'BEARISH';
  
  // Calcular spike de volumen (simulado)
  const volumeSpike = (Math.random() * 3 + 1).toFixed(1);
  
  return {
    rsi,
    volatility,
    volumeSpike,
    trend,
    support,
    resistance
  };
}

// Función para generar recomendaciones
function generateRecommendation(symbol, currentPrice, explosionScore, technicals) {
  const price = parseFloat(currentPrice);
  let action, confidence, buyPrice, sellTarget, stopLoss;
  
  buyPrice = price;
  
  if (explosionScore >= 80) {
    action = "🔥 COMPRA FUERTE";
    confidence = "MUY ALTA";
    sellTarget = (price * 1.25).toFixed(8);
    stopLoss = (price * 0.85).toFixed(8);
  } else if (explosionScore >= 60) {
    action = "📈 COMPRA MODERADA";
    confidence = "ALTA";
    sellTarget = (price * 1.15).toFixed(8);
    stopLoss = (price * 0.90).toFixed(8);
  } else if (explosionScore >= 40) {
    action = "⚡ OBSERVAR";
    confidence = "MEDIA";
    sellTarget = (price * 1.10).toFixed(8);
    stopLoss = (price * 0.92).toFixed(8);
  } else {
    action = "❌ EVITAR";
    confidence = "BAJA";
    sellTarget = (price * 1.05).toFixed(8);
    stopLoss = (price * 0.95).toFixed(8);
  }
  
  return {
    action,
    buyPrice,
    sellTarget,
    stopLoss,
    confidence
  };
}

// ENDPOINT 1: 🔥 Los mejores 5 para explosiones
app.get('/api/explosion-candidates', async (req, res) => {
  try {
    const cacheKey = 'explosion-candidates';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    const tickers = await fetchBinanceData('ticker/24hr');
    const usdtPairs = tickers.filter(t => 
      t.symbol.endsWith('USDT') && 
      parseFloat(t.priceChangePercent) > 8 &&
      parseFloat(t.volume) > 100000 &&
      !['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT'].includes(t.symbol)
    );
    
    const candidates = [];
    
    for (let i = 0; i < Math.min(5, usdtPairs.length); i++) {
      const ticker = usdtPairs[i];
      const historicalPrices = await getHistoricalPrices(ticker.symbol);
      const explosionScore = calculateExplosionScore(ticker, ticker.volume, historicalPrices);
      const technicals = await getTechnicalAnalysis(ticker.symbol, ticker.lastPrice, historicalPrices);
      const recommendation = generateRecommendation(ticker.symbol, ticker.lastPrice, explosionScore, technicals);
      
      candidates.push({
        symbol: ticker.symbol,
        price: parseFloat(ticker.lastPrice),
        priceChangePercent: parseFloat(ticker.priceChangePercent),
        explosionScore,
        technicals,
        recommendation
      });
    }
    
    // Ordenar por explosion score
    candidates.sort((a, b) => b.explosionScore - a.explosionScore);
    
    const result = {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: candidates.slice(0, 5)
    };
    
    cache.set(cacheKey, result);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: 'Error obteniendo candidatos de explosión',
      error: error.message 
    });
  }
});

// ENDPOINT 2: 📈 Top 5 regulares (más seguros)
app.get('/api/top-gainers', async (req, res) => {
  try {
    const cacheKey = 'top-gainers';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    const tickers = await fetchBinanceData('ticker/24hr');
    const stablePairs = tickers.filter(t => 
      t.symbol.endsWith('USDT') && 
      parseFloat(t.priceChangePercent) > 3 &&
      parseFloat(t.priceChangePercent) < 15 &&
      parseFloat(t.volume) > 500000 &&
      !['BTCUSDT', 'ETHUSDT'].includes(t.symbol)
    );
    
    const gainers = [];
    
    for (let i = 0; i < Math.min(5, stablePairs.length); i++) {
      const ticker = stablePairs[i];
      const historicalPrices = await getHistoricalPrices(ticker.symbol);
      const explosionScore = calculateExplosionScore(ticker, ticker.volume, historicalPrices);
      const technicals = await getTechnicalAnalysis(ticker.symbol, ticker.lastPrice, historicalPrices);
      const recommendation = generateRecommendation(ticker.symbol, ticker.lastPrice, explosionScore, technicals);
      
      gainers.push({
        symbol: ticker.symbol,
        price: parseFloat(ticker.lastPrice),
        priceChangePercent: parseFloat(ticker.priceChangePercent),
        explosionScore,
        technicals,
        recommendation
      });
    }
    
    // Ordenar por cambio de precio
    gainers.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    
    const result = {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: gainers.slice(0, 5)
    };
    
    cache.set(cacheKey, result);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: 'Error obteniendo top ganadores',
      error: error.message 
    });
  }
});

// ENDPOINT 3: 🆕 Nuevos listados
app.get('/api/new-listings', async (req, res) => {
  try {
    const cacheKey = 'new-listings';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    const tickers = await fetchBinanceData('ticker/24hr');
    
    // Filtrar tokens que podrían ser nuevos (basado en volumen bajo y precio)
    const newCandidates = tickers.filter(t => 
      t.symbol.endsWith('USDT') && 
      parseFloat(t.volume) < 10000000 &&
      parseFloat(t.volume) > 50000 &&
      parseFloat(t.priceChangePercent) > 0 &&
      !['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'SOLUSDT', 'DOTUSDT'].includes(t.symbol)
    );
    
    const newListings = [];
    
    for (let i = 0; i < Math.min(5, newCandidates.length); i++) {
      const ticker = newCandidates[i];
      const historicalPrices = await getHistoricalPrices(ticker.symbol);
      const explosionScore = calculateExplosionScore(ticker, ticker.volume, historicalPrices);
      const technicals = await getTechnicalAnalysis(ticker.symbol, ticker.lastPrice, historicalPrices);
      const recommendation = generateRecommendation(ticker.symbol, ticker.lastPrice, explosionScore, technicals);
      
      newListings.push({
        symbol: ticker.symbol,
        price: parseFloat(ticker.lastPrice),
        priceChangePercent: parseFloat(ticker.priceChangePercent),
        explosionScore,
        technicals,
        recommendation
      });
    }
    
    // Ordenar por explosion score
    newListings.sort((a, b) => b.explosionScore - a.explosionScore);
    
    const result = {
      status: 'success',
      timestamp: new Date().toISOString(),
      data: newListings.slice(0, 5)
    };
    
    cache.set(cacheKey, result);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: 'Error obteniendo nuevos listados',
      error: error.message 
    });
  }
});

// ENDPOINT 4: 🧠 Análisis completo
app.get('/api/smart-analysis', async (req, res) => {
  try {
    const cacheKey = 'smart-analysis';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    
    const tickers = await fetchBinanceData('ticker/24hr');
    const allCandidates = tickers.filter(t => 
      t.symbol.endsWith('USDT') && 
      parseFloat(t.priceChangePercent) > 2 &&
      parseFloat(t.volume) > 100000 &&
      !['BTCUSDT', 'ETHUSDT'].includes(t.symbol)
    );
    
    const analysis = [];
    
    for (let i = 0; i < Math.min(10, allCandidates.length); i++) {
      const ticker = allCandidates[i];
      const historicalPrices = await getHistoricalPrices(ticker.symbol);
      const explosionScore = calculateExplosionScore(ticker, ticker.volume, historicalPrices);
      const technicals = await getTechnicalAnalysis(ticker.symbol, ticker.lastPrice, historicalPrices);
      const recommendation = generateRecommendation(ticker.symbol, ticker.lastPrice, explosionScore, technicals);
      
      analysis.push({
        symbol: ticker.symbol,
        price: parseFloat(ticker.lastPrice),
        priceChangePercent: parseFloat(ticker.priceChangePercent),
        explosionScore,
        technicals,
        recommendation
      });
    }
    
    // Ordenar por explosion score
    analysis.sort((a, b) => b.explosionScore - a.explosionScore);
    
    const result = {
      status: 'success',
      timestamp: new Date().toISOString(),
      marketSummary: {
        totalAnalyzed: analysis.length,
        highPotential: analysis.filter(a => a.explosionScore > 70).length,
        mediumPotential: analysis.filter(a => a.explosionScore > 40 && a.explosionScore <= 70).length,
        lowPotential: analysis.filter(a => a.explosionScore <= 40).length
      },
      data: analysis.slice(0, 8)
    };
    
    cache.set(cacheKey, result);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      message: 'Error en análisis completo',
      error: error.message 
    });
  }
});

// ENDPOINT 5: ⚡ Estado del sistema
app.get('/api/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Probar conexión con Binance
    await fetchBinanceData('time');
    
    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      responseTime: `${responseTime}ms`,
      binanceConnection: 'OK',
      apiVersion: '1.0.0',
      endpoints: {
        '/api/explosion-candidates': '🔥 Candidatos de explosión',
        '/api/top-gainers': '📈 Top ganadores seguros',
        '/api/new-listings': '🆕 Nuevos listados',
        '/api/smart-analysis': '🧠 Análisis completo',
        '/api/health': '⚡ Estado del sistema'
      }
    });
    
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy', 
      message: 'Error en el sistema',
      error: error.message 
    });
  }
});

// Endpoint raíz
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Crypto Explosion API - Detectando oportunidades',
    version: '1.0.0',
    endpoints: {
      '/api/explosion-candidates': '🔥 Los mejores 5 para explosiones',
      '/api/top-gainers': '📈 Top 5 regulares (más seguros)',
      '/api/new-listings': '🆕 Nuevos listados',
      '/api/smart-analysis': '🧠 Análisis completo',
      '/api/health': '⚡ Estado del sistema'
    }
  });
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    status: 'error', 
    message: 'Error interno del servidor' 
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🔥 API de explosiones lista en: http://localhost:${PORT}`);
  console.log(`🚀 Railway URL: https://tu-dominio.railway.app`);
  console.log(`📊 Endpoints disponibles:`);
  console.log(`   - /api/explosion-candidates`);
  console.log(`   - /api/top-gainers`);
  console.log(`   - /api/new-listings`);
  console.log(`   - /api/smart-analysis`);
  console.log(`   - /api/health`);
});

module.exports = app;
