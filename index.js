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

// 新增：月数据库配置
const MONTHLY_DATABASE_ID = "2547857ae5f280baa14ae1139492c772";
const MONTHLY_DATABASE_DATA_SOURCE = "collection://2547857a-e5f2-80dd-8a31-000bf612dd67";

// 新增：周任务数据库配置
const WEEK_TASK_DATABASE_ID = "26f7857ae5f281c3aa3cc1d5aa872ce0";
const WEEK_TASK_DATA_SOURCE = "collection://26f7857a-e5f2-81c5-ae77-000b66054333";
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

// 工具函数：获取下月信息
function getNextMonthInfo() {
  const nextMonth = moment().add(1, 'month');
  return {
    monthName: `${nextMonth.month() + 1}月`,
    monthNumber: nextMonth.month() + 1,
    year: nextMonth.year(),
    startDate: nextMonth.startOf('month').format('YYYY-MM-DD'),
    endDate: nextMonth.endOf('month').format('YYYY-MM-DD')
  };
}

// 工具函数：获取指定月份包含的所有周数
function getWeeksInMonth(year, month) {
  const weeks = [];
  const startOfMonth = moment({ year, month: month - 1 }).startOf('month');
  const endOfMonth = moment({ year, month: month - 1 }).endOf('month');
  
  // 从月初的第一周开始
  let currentWeek = startOfMonth.clone().startOf('isoWeek');
  
  // 如果月初的周开始日期在上个月，也要包含
  while (currentWeek.isSameOrBefore(endOfMonth)) {
    // 检查这一周是否与当前月有重叠
    const weekStart = currentWeek.clone();
    const weekEnd = currentWeek.clone().endOf('isoWeek');
    
    if (weekEnd.isSameOrAfter(startOfMonth) && weekStart.isSameOrBefore(endOfMonth)) {
      weeks.push({
        weekNumber: currentWeek.isoWeek(),
        weekName: `${currentWeek.isoWeek()}周`,
        startDate: weekStart.format('YYYY-MM-DD'),
        endDate: weekEnd.format('YYYY-MM-DD'),
        year: currentWeek.year()
      });
    }
    
    currentWeek.add(1, 'week');
  }
  
  return weeks;
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

// 新增：月底定时任务端点 - 创建下月的月项目和所有周项目
app.post('/api/cron/create-monthly-structure', async (req, res) => {
  try {
    console.log('开始执行月底定时任务：创建下月的月项目和周项目...');
    
    const nextMonthInfo = getNextMonthInfo();
    const weeksInNextMonth = getWeeksInMonth(nextMonthInfo.year, nextMonthInfo.monthNumber);
    
    console.log(`准备创建月项目: ${nextMonthInfo.monthName}`);
    console.log(`包含周数: ${weeksInNextMonth.map(w => w.weekName).join(', ')}`);
    
    // 1. 创建月项目
    const monthPage = await notionApi.post('pages', {
      parent: {
        type: 'database_id',
        database_id: MONTHLY_DATABASE_ID
      },
      properties: {
        '月份': {
          title: [
            {
              text: {
                content: nextMonthInfo.monthName
              }
            }
          ]
        }
      }
    });
    
    console.log(`成功创建月项目: ${nextMonthInfo.monthName}, 页面ID: ${monthPage.data.id}`);
    
    // 2. 创建所有周项目并关联到月项目
    const createdWeeks = [];
    for (const week of weeksInNextMonth) {
      try {
        // 创建周项目页面
        const weekPage = await notionApi.post('pages', {
          parent: {
            type: 'database_id',
            database_id: WEEKLY_DATABASE_ID
          },
          properties: {
            '名称': {
              title: [
                {
                  text: {
                    content: week.weekName
                  }
                }
              ]
            },
            '日期': {
              date: {
                start: week.startDate
              }
            },
            '属于月': {
              relation: [
                {
                  id: monthPage.data.id
                }
              ]
            }
          }
        });
        
        console.log(`成功创建周项目: ${week.weekName}, 页面ID: ${weekPage.data.id}`);
        
        // 3. 在周页面内创建周任务数据库
        const weekTaskDatabase = await notionApi.post('databases', {
          parent: {
            type: 'page_id',
            page_id: weekPage.data.id
          },
          title: [
            {
              text: {
                content: `${week.weekName}任务`
              }
            }
          ],
          properties: {
            '名称': {
              title: {}
            },
            '完成': {
              checkbox: {}
            },
            '优先级': {
              select: {
                options: [
                  { name: '高优先级', color: 'red' },
                  { name: '中优先级', color: 'yellow' },
                  { name: '低优先级', color: 'blue' },
                  { name: '无优先级', color: 'default' }
                ]
              }
            },
            '状态': {
              status: {
                options: [
                  { name: '未开始', color: 'default' },
                  { name: '进行中', color: 'blue' },
                  { name: '完成', color: 'green' },
                  { name: '暂不完成', color: 'gray' }
                ],
                groups: [
                  {
                    name: 'To-do',
                    color: 'gray',
                    option_ids: []
                  },
                  {
                    name: 'In progress',
                    color: 'blue',
                    option_ids: []
                  },
                  {
                    name: 'Complete',
                    color: 'green',
                    option_ids: []
                  }
                ]
              }
            },
            '日期': {
              date: {}
            },
            '周': {
              relation: {
                database_id: WEEKLY_DATABASE_ID
              }
            }
          }
        });
        
        console.log(`成功创建周任务数据库: ${week.weekName}任务, 数据库ID: ${weekTaskDatabase.data.id}`);
        
        createdWeeks.push({
          weekName: week.weekName,
          weekPageId: weekPage.data.id,
          taskDatabaseId: weekTaskDatabase.data.id,
          startDate: week.startDate
        });
        
        // 添加短暂延迟避免API限制
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (weekError) {
        console.error(`创建周项目 ${week.weekName} 时出错:`, weekError.response?.data || weekError.message);
      }
    }
    
    res.status(200).json({
      success: true,
      message: `成功创建${nextMonthInfo.monthName}的项目结构`,
      monthPageId: monthPage.data.id,
      monthName: nextMonthInfo.monthName,
      createdWeeks: createdWeeks,
      totalWeeks: createdWeeks.length
    });
    
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data, null, 2) : error.message;
    console.error('创建月项目结构时出错:', errorMessage);
    
    res.status(500).json({
      success: false,
      error: '创建月项目结构失败',
      details: errorMessage
    });
  }
});

// 测试端点：立即测试月底功能
app.post('/api/test/create-monthly-structure', async (req, res) => {
  try {
    console.log('开始执行测试：立即创建下月的月项目和周项目...');
    
    // 直接调用月底定时任务的逻辑
    const nextMonthInfo = getNextMonthInfo();
    const weeksInNextMonth = getWeeksInMonth(nextMonthInfo.year, nextMonthInfo.monthNumber);
    
    console.log(`[测试模式] 准备创建月项目: ${nextMonthInfo.monthName}`);
    console.log(`[测试模式] 包含周数: ${weeksInNextMonth.map(w => w.weekName).join(', ')}`);
    
    // 1. 创建月项目
    const monthPage = await notionApi.post('pages', {
      parent: {
        type: 'database_id',
        database_id: MONTHLY_DATABASE_ID
      },
      properties: {
        '月份': {
          title: [
            {
              text: {
                content: `[测试]${nextMonthInfo.monthName}`
              }
            }
          ]
        }
      }
    });
    
    console.log(`[测试模式] 成功创建月项目: [测试]${nextMonthInfo.monthName}, 页面ID: ${monthPage.data.id}`);
    
    // 2. 创建所有周项目并关联到月项目
    const createdWeeks = [];
    for (const week of weeksInNextMonth.slice(0, 2)) { // 测试模式只创建前2周，避免创建太多
      try {
        // 创建周项目页面
        const weekPage = await notionApi.post('pages', {
          parent: {
            type: 'database_id',
            database_id: WEEKLY_DATABASE_ID
          },
          properties: {
            '名称': {
              title: [
                {
                  text: {
                    content: `[测试]${week.weekName}`
                  }
                }
              ]
            },
            '日期': {
              date: {
                start: week.startDate
              }
            },
            '属于月': {
              relation: [
                {
                  id: monthPage.data.id
                }
              ]
            }
          }
        });
        
        console.log(`[测试模式] 成功创建周项目: [测试]${week.weekName}, 页面ID: ${weekPage.data.id}`);
        
        // 3. 在周页面内创建周任务数据库
        const weekTaskDatabase = await notionApi.post('databases', {
          parent: {
            type: 'page_id',
            page_id: weekPage.data.id
          },
          title: [
            {
              text: {
                content: `[测试]${week.weekName}任务`
              }
            }
          ],
          properties: {
            '名称': {
              title: {}
            },
            '完成': {
              checkbox: {}
            },
            '优先级': {
              select: {
                options: [
                  { name: '高优先级', color: 'red' },
                  { name: '中优先级', color: 'yellow' },
                  { name: '低优先级', color: 'blue' },
                  { name: '无优先级', color: 'default' }
                ]
              }
            },
            '状态': {
              status: {
                options: [
                  { name: '未开始', color: 'default' },
                  { name: '进行中', color: 'blue' },
                  { name: '完成', color: 'green' },
                  { name: '暂不完成', color: 'gray' }
                ],
                groups: [
                  {
                    name: 'To-do',
                    color: 'gray',
                    option_ids: []
                  },
                  {
                    name: 'In progress',
                    color: 'blue',
                    option_ids: []
                  },
                  {
                    name: 'Complete',
                    color: 'green',
                    option_ids: []
                  }
                ]
              }
            },
            '日期': {
              date: {}
            },
            '周': {
              relation: {
                database_id: WEEKLY_DATABASE_ID
              }
            }
          }
        });
        
        console.log(`[测试模式] 成功创建周任务数据库: [测试]${week.weekName}任务, 数据库ID: ${weekTaskDatabase.data.id}`);
        
        createdWeeks.push({
          weekName: `[测试]${week.weekName}`,
          weekPageId: weekPage.data.id,
          taskDatabaseId: weekTaskDatabase.data.id,
          startDate: week.startDate
        });
        
        // 添加短暂延迟避免API限制
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (weekError) {
        console.error(`[测试模式] 创建周项目 ${week.weekName} 时出错:`, weekError.response?.data || weekError.message);
      }
    }
    
    res.status(200).json({
      success: true,
      message: `[测试模式] 成功创建${nextMonthInfo.monthName}的项目结构`,
      monthPageId: monthPage.data.id,
      monthName: `[测试]${nextMonthInfo.monthName}`,
      createdWeeks: createdWeeks,
      totalWeeks: createdWeeks.length,
      note: '测试模式只创建了前2周的项目，正式运行会创建完整月份的所有周'
    });
    
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data, null, 2) : error.message;
    console.error('[测试模式] 创建月项目结构时出错:', errorMessage);
    
    res.status(500).json({
      success: false,
      error: '[测试模式] 创建月项目结构失败',
      details: errorMessage
    });
  }
});

// 健康检查端点
app.get('/api/health', (req, res) => {
  const nextMonthInfo = getNextMonthInfo();
  const weeksInNextMonth = getWeeksInMonth(nextMonthInfo.year, nextMonthInfo.monthNumber);
  
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    nextWeek: formatISOWeekNumber(getNextWeekISONumber()),
    nextMonth: nextMonthInfo,
    weeksInNextMonth: weeksInNextMonth
  });
});

app.listen(PORT, () => {
  console.log(`Final corrected server is running and listening on http://localhost:${PORT}`);
});