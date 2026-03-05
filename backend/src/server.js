import 'dotenv/config';
import createApp from './app.js';

const port = Number(process.env.PORT || 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});
