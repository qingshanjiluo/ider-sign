// pages/help.js — 帮助文档页
import { icon } from '../icons.js';

export function renderHelp({ container }) {
  container.innerHTML = `
    <style>
      .help-page {
        max-width: 800px;
        margin: 0 auto;
        padding: 40px 24px;
      }
      .help-page h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin-bottom: 8px;
        color: var(--text-primary);
      }
      .help-page .subtitle {
        color: var(--text-secondary);
        margin-bottom: 32px;
        font-size: var(--text-base);
      }
      .help-section {
        background: var(--bg-card);
        border-radius: var(--radius-xl);
        margin-bottom: 16px;
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }
      .help-section-header {
        padding: 16px 20px;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
        font-size: var(--text-base);
        color: var(--text-primary);
        user-select: none;
      }
      .help-section-header:hover {
        background: var(--bg-card-hover);
      }
      .help-section-header .arrow {
        transition: transform 0.2s ease;
        color: var(--text-tertiary);
      }
      .help-section.open .help-section-header .arrow {
        transform: rotate(90deg);
      }
      .help-section-body {
        display: none;
        padding: 0 20px 16px;
        color: var(--text-secondary);
        font-size: var(--text-sm);
        line-height: 1.7;
      }
      .help-section.open .help-section-body {
        display: block;
      }
      .help-section-body ul {
        padding-left: 20px;
        margin: 8px 0;
      }
      .help-section-body li {
        margin-bottom: 6px;
      }
      .help-section-body strong {
        color: var(--text-primary);
      }
      .help-section-body .badge {
        display: inline-block;
        padding: 1px 8px;
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        font-weight: 600;
      }
      .badge-green { background: var(--accent-green-light); color: var(--accent-green); }
      .badge-amber { background: var(--accent-amber-light); color: var(--accent-amber); }
      .badge-blue { background: var(--accent-blue-light); color: var(--accent-blue); }
      .level-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 8px;
        margin: 12px 0;
      }
      .level-item {
        text-align: center;
        padding: 8px;
        background: var(--bg-base);
        border-radius: var(--radius-md);
        font-size: var(--text-sm);
      }
      .level-item .lv { font-weight: 700; color: var(--accent-blue); }
      .level-item .title { color: var(--text-primary); }
    </style>

    <div class="help-page">
      <h1>帮助文档</h1>
      <p class="subtitle">了解如何使用艾德尔修仙工单平台</p>

      <div class="help-section open">
        <div class="help-section-header" onclick="this.parentElement.classList.toggle('open')">
          <span>快速入门</span>
          <span class="arrow">▸</span>
        </div>
        <div class="help-section-body">
          <p><strong>1. 注册账号</strong></p>
          <p>访问注册页面，填写用户名、密码和邀请码即可完成注册。如无邀请码可联系站长获取。</p>
          <p style="margin-top:12px;"><strong>2. 提交工单</strong></p>
          <p>登录后在控制台点击「提交新工单」。</p>
          <p style="margin-top:12px;"><strong>3. 充值修仙币</strong></p>
          <p>在充值页面选择套餐 → 查看注意事项 → 扫码支付 → 提交申请 → 管理员审核后自动生成兑换码 → 在坊市或充值页输入兑换码激活修仙币。</p>
          <p style="margin-top:12px;"><strong>4. 使用坊市</strong></p>
          <p>修仙坊市分为官方市场和黑市，使用修仙币购买物品或自由交易。</p>
        </div>
      </div>

      <div class="help-section">
        <div class="help-section-header" onclick="this.parentElement.classList.toggle('open')">
          <span>等级与称号</span>
          <span class="arrow">▸</span>
        </div>
        <div class="help-section-body">
          <p>用户等级通过完成工单获得经验值提升，每个等级对应不同称号：</p>
          <div class="level-grid">
            <div class="level-item"><div class="lv">Lv.1</div><div class="title">仙友</div></div>
            <div class="level-item"><div class="lv">Lv.2</div><div class="title">仙长</div></div>
            <div class="level-item"><div class="lv">Lv.3</div><div class="title">仙师</div></div>
            <div class="level-item"><div class="lv">Lv.4</div><div class="title">宗师</div></div>
            <div class="level-item"><div class="lv">Lv.5</div><div class="title">大宗师</div></div>
            <div class="level-item"><div class="lv">Lv.6</div><div class="title">仙王</div></div>
            <div class="level-item"><div class="lv">Lv.7</div><div class="title">尊者</div></div>
            <div class="level-item"><div class="lv">Lv.8</div><div class="title">道主</div></div>
            <div class="level-item"><div class="lv">Lv.9</div><div class="title">至尊</div></div>
            <div class="level-item"><div class="lv">Lv.10</div><div class="title">仙尊</div></div>
          </div>
          <p>等级权益（折扣在提交工单时自动计算）：</p>
          <ul>
            <li>Lv.3 享 <strong>10%</strong> 折扣</li>
            <li>Lv.5 享 <strong>30%</strong> 折扣</li>
            <li>Lv.8 享 <strong>50%</strong> 折扣</li>
            <li>Lv.10 享 <strong>70%</strong> 折扣（上限）</li>
          </ul>
        </div>
      </div>

      <div class="help-section">
        <div class="help-section-header" onclick="this.parentElement.classList.toggle('open')">
          <span>修仙币充值</span>
          <span class="arrow">▸</span>
        </div>
        <div class="help-section-body">
          <p><strong>修仙币</strong>是本平台的流通货币，可在坊市购买物品或进行交易。</p>
          <p style="margin-top:12px;"><strong>现金套餐（微信支付）：</strong></p>
          <ul>
            <li>初入仙途 — ¥5 = 2500 修仙币</li>
            <li>小有所成 — ¥10 = 5200 修仙币</li>
            <li>渐入佳境 — ¥15 = 8000 修仙币</li>
            <li>炉火纯青 — ¥20 = 12000 修仙币</li>
            <li>登堂入室 — ¥30 = 18000 修仙币</li>
            <li>一代宗师 — ¥50 = 25000 修仙币</li>
          </ul>
          <p style="margin-top:12px;"><strong>灵石套餐（游戏内灵石支付）：</strong></p>
          <ul>
            <li>灵石入门 — 500万灵石 = 70 修仙币</li>
            <li>灵石小成 — 1000万灵石 = 150 修仙币</li>
            <li>灵石大成 — 3000万灵石 = 400 修仙币</li>
            <li>灵石巅峰 — 5000万灵石 = 700 修仙币</li>
            <li>灵石至尊 — 1亿灵石 = 1500 修仙币</li>
          </ul>
          <p style="margin-top:12px;"><strong>基础充值：</strong></p>
          <ul>
            <li>现金：1元 = 400 修仙币（最低1元起充）</li>
            <li>灵石：100万灵石 = 10 修仙币（最低100万起充）</li>
          </ul>
          <p style="margin-top:12px;"><strong>到账流程：</strong>提交→管理员审核→自动生成兑换码→输入兑换码到账</p>
        </div>
      </div>

      <div class="help-section">
        <div class="help-section-header" onclick="this.parentElement.classList.toggle('open')">
          <span>邀请返利</span>
          <span class="arrow">▸</span>
        </div>
        <div class="help-section-body">
          <p>邀请好友注册可享受返利：</p>
          <ul>
            <li>默认返利比例 <strong>30%</strong></li>
            <li>好友每次消费您可获得返利</li>
            <li>返利以修仙分形式发放</li>
            <li>邀请越多，购买邀请套餐可提升返利比例</li>
          </ul>
          <p>邀请返利套餐（提升返利倍率）：</p>
          <ul>
            <li>小试牛刀 — ¥50，青铜倍率 (1.2x)</li>
            <li>渐入佳境 — ¥100，白银倍率 (1.5x)</li>
            <li>如虎添翼 — ¥250，黄金倍率 (2.0x)</li>
            <li>登峰造极 — ¥500，至尊倍率 (3.0x)</li>
            <li>至尊无敌 — ¥1000，满级倍率 (3.0x) + 专属标识</li>
          </ul>
        </div>
      </div>

      <div class="help-section">
        <div class="help-section-header" onclick="this.parentElement.classList.toggle('open')">
          <span>修仙坊市</span>
          <span class="arrow">▸</span>
        </div>
        <div class="help-section-body">
          <p>修仙坊市是平台的交易市场，分为：</p>
          <p style="margin-top:8px;"><strong>官方市场</strong></p>
          <ul>
            <li>管理员上架的固定商品</li>
            <li>明码标价，即买即得</li>
            <li>库存有限，售完即止</li>
          </ul>
          <p style="margin-top:8px;"><strong>黑市</strong></p>
          <ul>
            <li>玩家间自由交易</li>
            <li>可发布求购或售卖订单</li>
            <li>双方确认交易，平台抽取5%手续费</li>
            <li>支持发布/接单/发货/确认收货流程</li>
          </ul>
        </div>
      </div>

      <div class="help-section">
        <div class="help-section-header" onclick="this.parentElement.classList.toggle('open')">
          <span>常见问题</span>
          <span class="arrow">▸</span>
        </div>
        <div class="help-section-body">
          <p><strong>Q: 充值后多久到账？</strong></p>
          <p>A: 提交充值申请后，管理员审核通过将自动生成兑换码，您输入兑换码后立即到账。</p>
          <p style="margin-top:12px;"><strong>Q: 如何输入兑换码？</strong></p>
          <p>A: 在坊市页面「兑换码」标签页输入，或充值页面第三步填入兑换码即可激活修仙币。</p>
          <p style="margin-top:12px;"><strong>Q: 工单提交后多久开始处理？</strong></p>
          <p>A: 管理员审批通过后即开始处理，一般24小时内完成。</p>
          <p style="margin-top:12px;"><strong>Q: 如何查看账号进度？</strong></p>
          <p>A: 在工单详情页可查看每个账号的实时状态，包括等级、地图等信息。</p>
          <p style="margin-top:12px;"><strong>Q: 遇到问题怎么办？</strong></p>
          <p>A: 可通过申诉中心提交申诉，或通过联系站长页面留言。</p>
        </div>
      </div>
    </div>`;
}
