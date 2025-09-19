require('dotenv').config(); // 必须在最顶部，加载 .env 文件里的变量
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// --- 配置区 (保持不变) ---
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const CHECKBOX_PROPERTY_NAME = "完成";
const STATUS_PROPERTY_NAME = "状态";
const DONE_STATUS_NAME = "完成";
const DATE_PROPERTY_NAME = "完成时间";
// -------------------------

// 检查密钥是否成功加载
if (!NOTION_API_KEY) {
  console.error("CRITICAL ERROR: NOTION_API_KEY environment variable is not set.");
  process.exit(1);
}

const notionApi = axios.create({
  baseURL: 'https://api.notion.com/v1/',
  headers: {
    'Authorization': `Bearer ${NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  }
});

app.use(express.json());

app.post('/notion-webhook', async (req, res) => {
  const body = req.body;

  // 打印最原始的请求体，确保我们能看到所有东西
  console.log("Received new request from Notion:", JSON.stringify(body, null, 2));

  // Notion 的手动验证流程
  if (body.type && body.type === 'url_verification') {
    console.log("Responding to Notion URL verification challenge.");
    return res.json({ challenge: body.challenge });
  }

  // Notion 的手动验证流程 (另一种格式)
  if (body.verification_token) {
    console.log("Received a manual verification token request.");
    // 这种情况下我们只需要在日志里看到token就行，所以回复一个成功状态
    return res.sendStatus(200);
  }

  try {
    if (body.type === 'page.properties_updated') {
      const pageId = body.entity.id;
      console.log(`Received update for page [${pageId}], fetching full page data...`);

      const pageResponse = await notionApi.get(`pages/${pageId}`);
      const pageProperties = pageResponse.data.properties;

      const checkboxValue = pageProperties[CHECKBOX_PROPERTY_NAME]?.checkbox;
      const statusValue = pageProperties[STATUS_PROPERTY_NAME]?.status?.name;

      console.log(`Page [${pageId}] current state -> Checkbox: ${checkboxValue}, Status: ${statusValue}`);

      if (checkboxValue === true && statusValue !== DONE_STATUS_NAME) {
        console.log(`Condition met for page [${pageId}]. Proceeding with update...`);
        
        await notionApi.patch(`pages/${pageId}`, {
          properties: {
            [STATUS_PROPERTY_NAME]: { status: { name: DONE_STATUS_NAME } },
            [DATE_PROPERTY_NAME]: { date: { start: new Date().toISOString() } }
          }
        });
        
        console.log(`Successfully updated page [${pageId}]!`);
      } else {
        console.log(`No action needed for page [${pageId}].`);
      }
    }
    // 在所有操作成功完成后，发送成功响应
    res.sendStatus(200);
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data, null, 2) : error.message;
    console.error("Error processing webhook:", errorMessage);
    // 即使出错，也回复一个成功状态，防止 Notion 不断重试
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Final corrected server is running and listening on http://localhost:${PORT}`);
});