const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const s3 = new AWS.S3();
const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT),
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const CDN_DOMAIN = process.env.CDN_DOMAIN;

const resolutions = [
  { suffix: 'sm', width: 300 },
  { suffix: 'md', width: 600 },
  { suffix: 'lg', width: 1200 },
];

router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    const category = req.body.category || 'uncategorized';
    const name = req.body.name || file.originalname;

    const imageId = uuidv4();
    const folder = `uploads/${imageId}`;

    const uploadedVariants = await Promise.all(
      resolutions.map(async ({ suffix, width }) => {
        const buffer = await sharp(file.buffer)
          .resize({ width })
          .toFormat('webp')
          .toBuffer();

        const key = `${folder}/${suffix}.webp`;
        await s3.putObject({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: 'image/webp',
        }).promise();

        return {
          resolution: suffix,
          width,
          url: `https://${CDN_DOMAIN}/${key}`,
        };
      })
    );

    const item = {
      id: imageId,
      name,
      category,
      createdAt: Date.now(),
      resolutions: uploadedVariants,
    };

    // Cache in Redis
    await redis.set(`image:${imageId}`, JSON.stringify(item));

    res.status(200).json(item);
  } catch (err) {
    console.error(err);
    res.status(500).send('Upload failed');
  }
});

module.exports = router;
