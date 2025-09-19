require('dotenv').config(); // 必须在最顶部，加载 .env 文件里的变量
const express = require('express');
const axios = require('axios');
const app = express();
const PORT = 3000;

// --- 配置区 ---
// !! 从环境变量中读取密钥，而不是直接写在这里 !!
const NOTION_API_KEY = process.env.NOTION_API_KEY;

// 检查密钥是否成功加载
if (!NOTION_API_KEY) {
  console.error("错误：请确保 .env 文件中已配置 NOTION_API_KEY");
  process.exit(1); // 如果没有密钥，则退出程序
}

// !! 【新增】请在这里填入你的“复选框”属性的准确名称 !!
const CHECKBOX_PROPERTY_NAME = "完成"; // 例如，你的复选框属性可能叫“完成”或“Done”

// 【修改】这两个现在是我们要“写入”的目标，而不是触发器
const STATUS_PROPERTY_NAME = "状态";     // 你想要自动更新的“状态”属性的名称
const DONE_STATUS_NAME = "完成";       // 你想把状态更新成的那个选项的名称
const DATE_PROPERTY_NAME = "完成时间";   // 你想自动填充的日期属性的名称
// ------------------------------------------

const notionApi = axios.create({
  baseURL: 'https://api.notion.com/v1/',
  headers: {
    'Authorization': `Bearer ${NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28' // 建议使用较新且固定的API版本
  }
});

app.use(express.json());

app.post('/notion-webhook', async (req, res) => {
  const body = req.body;
  
  // 立即响应Notion，防止超时。后续操作异步执行。
  res.sendStatus(200); 

  // --- 核心修改：适配新的数据格式和流程 ---
  try {
    // 检查事件类型是否为页面属性更新
    if (body.type === 'page.properties_updated') {
      const pageId = body.entity.id;
      console.log(`收到页面 [${pageId}] 的更新通知，正在查询最新数据...`);

      // 1. 主动通过 API 查询该页面的完整信息
      const pageResponse = await notionApi.get(`pages/${pageId}`);
      const pageProperties = pageResponse.data.properties;

      // 2. 从查询回来的完整信息中，获取我们关心的属性值
      const checkboxValue = pageProperties[CHECKBOX_PROPERTY_NAME]?.checkbox;
      const statusValue = pageProperties[STATUS_PROPERTY_NAME]?.status?.name;

      console.log(`查询到页面 [${pageId}] 的复选框状态为: ${checkboxValue}, 状态为: ${statusValue}`);

      // 3. 进行判断：如果复选框被勾选 (true)，并且当前状态不是“已完成”
      if (checkboxValue === true && statusValue !== DONE_STATUS_NAME) {
        console.log(`检测到页面 [${pageId}] 需要更新，准备执行双重更新...`);

        // 4. 执行更新动作
        await notionApi.patch(`pages/${pageId}`, {
          properties: {
            [STATUS_PROPERTY_NAME]: {
              status: { name: DONE_STATUS_NAME }
            },
            [DATE_PROPERTY_NAME]: {
              date: { start: new Date().toISOString() }
            }
          }
        });
        
        console.log(`成功更新页面 [${pageId}] 的状态和完成时间！`);
      } else {
        console.log(`页面 [${pageId}] 无需操作。`);
      }
    }
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data, null, 2) : error.message;
    console.error("处理更新时出错:", errorMessage);
  }
});

app.listen(PORT, () => {
  console.log(`适配最新格式的服务器已启动，正在监听 http://localhost:${PORT}`);
});