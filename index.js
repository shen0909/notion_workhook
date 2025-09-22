require('dotenv').config(); // 必须在最顶部，加载 .env 文件里的变量
const express = require('express');
const axios = require('axios');
const moment = require('moment');
const app = express();
const PORT = 3000;

// --- 配置区 (保持不变) ---
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const CHECKBOX_PROPERTY_NAME = "完成";
const STATUS_PROPERTY_NAME = "状态";
const DONE_STATUS_NAME = "完成";
const DATE_PROPERTY_NAME = "完成时间";

// 新增：周数据库配置
const WEEKLY_DATABASE_ID = "2547857ae5f2809686acf21e7160cb24";
const WEEKLY_DATABASE_DATA_SOURCE = "collection://2547857a-e5f2-80db-9e59-000bda03dd73";
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

// 工具函数：计算下一周的ISO周数
function getNextWeekISONumber() {
  const nextWeek = moment().add(1, 'week');
  return nextWeek.isoWeek();
}

// 工具函数：格式化ISO周数显示
function formatISOWeekNumber(weekNumber) {
  const currentYear = moment().year();
  const nextWeekYear = moment().add(1, 'week').year();
  return `${weekNumber}周`;
}

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

// 新增：定时任务端点 - 创建下周的项目
app.post('/api/cron/create-weekly-task', async (req, res) => {
  try {
    console.log('开始执行定时任务：创建下周的周项目...');
    
    const nextWeekNumber = getNextWeekISONumber();
    const weekTitle = formatISOWeekNumber(nextWeekNumber);
    const nextWeekDate = moment().add(1, 'week').startOf('isoWeek');
    
    console.log(`准备创建项目: ${weekTitle}, 日期: ${nextWeekDate.format('YYYY-MM-DD')}`);
    
    // 创建新的页面到Notion数据库
    const response = await notionApi.post('pages', {
      parent: {
        type: 'database_id',
        database_id: WEEKLY_DATABASE_ID
      },
      properties: {
        '名称': {
          title: [
            {
              text: {
                content: weekTitle
              }
            }
          ]
        },
        '日期': {
          date: {
            start: nextWeekDate.format('YYYY-MM-DD')
          }
        }
      }
    });
    
    console.log(`成功创建周项目: ${weekTitle}, 页面ID: ${response.data.id}`);
    
    res.status(200).json({
      success: true,
      message: `成功创建${weekTitle}的项目`,
      pageId: response.data.id,
      weekTitle: weekTitle,
      date: nextWeekDate.format('YYYY-MM-DD')
    });
    
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data, null, 2) : error.message;
    console.error('创建周项目时出错:', errorMessage);
    
    res.status(500).json({
      success: false,
      error: '创建周项目失败',
      details: errorMessage
    });
  }
});

// 健康检查端点
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    nextWeek: formatISOWeekNumber(getNextWeekISONumber())
  });
});

app.listen(PORT, () => {
  console.log(`Final corrected server is running and listening on http://localhost:${PORT}`);
});