const express = require('express');
const app = express();

const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

app.get('/', (req, res) => {
  res.send('Belle Noor backend is running!');
});

app.get('/health', (req, res) => {
  res.send('OK');
});

app.get('/cache-test', async (req, res) => {
    await redis.set('hello', 'world');
    const value = await redis.get('hello');
    res.send({ value });
  });

app.listen(80, () => {
  console.log('Server listening on port 80');
});

