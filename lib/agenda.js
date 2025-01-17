const Agenda = require('agenda'); // agenda 或者 bull   
const assert = require('assert')
const ms = require('humanize-ms');

module.exports = (agent) => {
  let count = 0;
  assert('config.agenda.db.address: %s, ', agent.config.agenda.db.address);
  assert('config.agenda.db.collection: %s', agent.config.agenda.db.collection);

  if(!agent.config.agenda.db || !agent.config.agenda.db.address) {
    assert('please check agent.config.agenda.db config');
    return
  }
  // 初始化 agenda
  let agenda;
  try {
    agenda = new Agenda(agent.config.agenda);
    agent.coreLogger.info('egg-cluster-schedule init successful');
    // job 每次执行都会 触发 start 
    agenda.on("start", (job) => {
      assert(`Job starting: ${job.attrs.name}`);
    });
    
    agenda.on("fail", (err, job) => {
      assert(`Job error: ${job.attrs.name}`, err);
      agent.coreLogger.info(`Job error: ${job.attrs.name}`, err);
    });
  } catch (error) {
    assert('egg-cluster-schedule: new Agenda error', error);
    agent.coreLogger.error('egg-cluster-schedule init failed', error);
    throw Error('egg-cluster-schedule: new Agenda error')
  }
  //添加调度任务
  const addAgendaJob = async (ctx, opt) => {
    const { agent, name, cron, interval, immediate } = opt;
    agent.coreLogger.info(`egg-cluster-schedule: job No ${count++}`);
    if(cron) {
      agenda.define(name, async (job) => {
        agent.emit(name, ctx.schedule);
      });
      
      await agenda.every(cron, name, {}, { skipImmediate: !immediate });
    } else if(interval) {
      const msTime = ms(interval);
      agenda.define(name, async (job) => {
        agent.emit(name, ctx.schedule);
      });

      await agenda.every(`${msTime / 1000} seconds`, name, {}, { skipImmediate: !immediate });
    }

    agent.on(name, (...args) => {
      // console.log(`agent.on ${name}`,  args)
      // 触发 egg schedule 任务，只允许一个 worker 进程
      ctx.sendOne(...args);
    });
  }

  class ClusterStrategy extends agent.ScheduleStrategy {
    start() {
      ;(async () => {
        const { key, schedule } = this
        if(schedule.type === 'cluster') {
          const immediate = schedule.immediate || false;
          if(schedule.cron) {
            await addAgendaJob(this, { agent, name: key, cron: schedule.cron, immediate, })
          } else if(schedule.interval) {
            await addAgendaJob(this, { agent, name: key, interval: schedule.interval, immediate })
          }
        }
      })();
    }
  }

  agent.schedule.use('cluster', ClusterStrategy);

  agent.messenger.on('egg-ready', async () => {
    assert('egg-cluster-schedule-start');
    agent.coreLogger.info(`egg-cluster-schedule-start`);
    await agenda.start();

    // 进程结束时需要解锁调度任务
    async function graceful() {
      assert('---- agent process exit ---')
      // console.log('---- agent process exit ---');
      await agenda.stop();
      process.exit(0);
    }

    process.on("SIGTERM", graceful);
    process.on("SIGINT", graceful);
  });

  agent.beforeClose(() => {
    // console.log('agent.beforeClose');
  })
}