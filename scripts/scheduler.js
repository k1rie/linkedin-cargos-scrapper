require('dotenv').config();
const cron = require('node-cron');
const scrapeService = require('../services/scrapeService');

let isRunning = false;

// Configuración del scheduler
const SCHEDULER_ENABLED = process.env.SCHEDULER_ENABLED === 'true';
const SCHEDULER_INTERVAL_MINUTES = parseInt(process.env.SCHEDULER_INTERVAL_MINUTES || '1440'); // 24 horas por defecto

const runScheduledScrape = async () => {
  if (isRunning) {
    console.log('[Scheduler] Scraping already in progress, skipping this run...');
    return;
  }

  try {
    isRunning = true;
    console.log(`[Scheduler] ${new Date().toISOString()} - Starting scheduled scrape...`);

    // Ejecutar el scraping completo usando scrapeService
    const result = await scrapeService.startScraping();

    if (result.success) {
      console.log(`[Scheduler] ✅ Scheduled scrape completed successfully`);
    } else {
      console.log(`[Scheduler] ❌ Scheduled scrape completed with issues: ${result.message || 'Unknown error'}`);
    }

  } catch (error) {
    console.error('[Scheduler] ❌ Error in scheduled scrape:', error.message);
  } finally {
    isRunning = false;
  }
};

// Función para convertir minutos a expresión cron
const minutesToCron = (minutes) => {
  if (minutes < 60) {
    return `*/${minutes} * * * *`; // Cada X minutos
  } else {
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`; // Cada X horas
  }
};

if (SCHEDULER_ENABLED) {
  console.log('[Scheduler] Starting scheduler...');
  console.log(`[Scheduler] Will run every ${SCHEDULER_INTERVAL_MINUTES} minutes`);
  console.log(`[Scheduler] Cron expression: ${minutesToCron(SCHEDULER_INTERVAL_MINUTES)}`);

  // Ejecutar inmediatamente al iniciar (opcional)
  if (process.argv.includes('--run-immediately')) {
    console.log('[Scheduler] Running immediately as requested...');
    runScheduledScrape();
  }

  // Programar ejecución según el intervalo configurado
  const cronExpression = minutesToCron(SCHEDULER_INTERVAL_MINUTES);
  cron.schedule(cronExpression, () => {
    runScheduledScrape();
  });

  console.log(`[Scheduler] ✅ Scheduler started. Next run: ${new Date(Date.now() + SCHEDULER_INTERVAL_MINUTES * 60000).toISOString()}`);
  console.log('[Scheduler] Press Ctrl+C to stop');
} else {
  console.log('[Scheduler] ❌ Scheduler is disabled (SCHEDULER_ENABLED=false)');
  console.log('[Scheduler] Run manually with: npm run scrape');
}

// Manejar cierre graceful
process.on('SIGINT', () => {
  console.log('\n[Scheduler] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Scheduler] Shutting down gracefully...');
  process.exit(0);
});

