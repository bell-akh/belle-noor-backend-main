const express = require('express');

const uploadRoute = require('./upload');
const fetchImagesRoute = require('./fetch-images');

const app = express();

app.use(express.json());
app.use(uploadRoute);
app.use(fetchImagesRoute);

app.get('/', (req, res) => res.send('Belle Noor backend running'));
app.get('/health', (req, res) => res.send('OK'));

app.listen(80, () => {
  console.log('Server listening on port 80');
});
