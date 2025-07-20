const express = require('express');
const Redis = require('ioredis');

const router = express.Router();
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT),
});

router.get('/images', async (req, res) => {
  try {
    const keys = await redis.keys('image:*');

    if (keys.length === 0) {
      return res.status(200).json([]); // No data in Redis
    }

    const values = await redis.mget(keys);
    const images = values.map((val) => JSON.parse(val));

    res.status(200).json(images);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch images');
  }
});

module.exports = router;
