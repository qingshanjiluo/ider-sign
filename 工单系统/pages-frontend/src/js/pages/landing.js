// pages/landing.js — Landing Page（简介主页）
import { store } from '../store.js';
import { icon } from '../icons.js';

export function renderLanding({ container }) {
  const isLoggedIn = store.isLoggedIn();

  container.innerHTML = `
    <style>
      .landing {
        min-height: 100vh;
        background: linear-gradient(135deg, #F5F3F0 0%, #EDE9E6 50%, #F5F3F0 100%);
      }
      .landing-hero {
        text-align: center;
        padding: 80px 24px 60px;
        max-width: 800px;
        margin: 0 auto;
      }
      .landing-hero h1 {
        font-size: 2.5rem;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 12px;
        letter-spacing: -0.5px;
      }
      .landing-hero .subtitle {
        font-size: 1.125rem;
        color: var(--text-secondary);
        margin-bottom: 32px;
        line-height: 1.6;
      }
      .landing-hero .cta-group {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
      }
      .landing-hero .btn-hero {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 32px;
        border-radius: var(--radius-lg);
        font-size: var(--text-lg);
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        border: none;
        transition: all 0.2s ease;
      }
      .btn-hero-primary {
        background: var(--bg-sidebar);
        color: #fff;
      }
      .btn-hero-primary:hover {
        background: #3A3A3A;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(44,44,44,0.2);
      }
      .btn-hero-secondary {
        background: transparent;
        color: var(--text-primary);
        border: 1.5px solid var(--border-default);
      }
      .btn-hero-secondary:hover {
        border-color: var(--text-primary);
        transform: translateY(-1px);
      }
      .landing-features {
        max-width: 1000px;
        margin: 0 auto;
        padding: 40px 24px 60px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 24px;
      }
      .feature-card {
        background: var(--bg-card);
        border-radius: var(--radius-xl);
        padding: 28px;
        text-align: center;
        box-shadow: var(--shadow-sm);
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .feature-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md);
      }
      .feature-card .icon svg {
        display: block;
        margin: 0 auto 12px;
        color: var(--accent-amber);
      }
      .feature-card h3 {
        font-size: var(--text-lg);
        font-weight: 600;
        margin-bottom: 8px;
        color: var(--text-primary);
      }
      .feature-card p {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        line-height: 1.6;
      }
      .landing-pricing {
        max-width: 900px;
        margin: 0 auto;
        padding: 20px 24px 60px;
      }
      .landing-pricing h2 {
        text-align: center;
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 24px;
        color: var(--text-primary);
      }
      .pricing-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
      }
      .pricing-card {
        background: var(--bg-card);
        border-radius: var(--radius-xl);
        padding: 24px;
        text-align: center;
        box-shadow: var(--shadow-sm);
        border: 1px solid var(--border-light);
      }
      .pricing-card.featured {
        border: 2px solid var(--bg-sidebar);
        transform: scale(1.02);
      }
      .pricing-card .title {
        font-weight: 600;
        font-size: var(--text-lg);
        margin-bottom: 8px;
      }
      .pricing-card .price {
        font-size: 1.75rem;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 8px;
      }
      .pricing-card .desc {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .landing-cta {
        text-align: center;
        padding: 40px 24px 60px;
      }
      .landing-cta h2 {
        font-size: 1.5rem;
        font-weight: 700;
        margin-bottom: 16px;
      }
      .landing-footer {
        text-align: center;
        padding: 24px;
        color: var(--text-tertiary);
        font-size: var(--text-sm);
        border-top: 1px solid var(--border-light);
      }
      .landing-footer a {
        color: var(--text-secondary);
        text-decoration: none;
      }
      .landing-footer a:hover {
        color: var(--text-primary);
      }
    </style>

    <div class="landing">
      <!-- Hero -->
      <section class="landing-hero">
        <h1>${icon('asterisk', 24)} 艾德尔修仙工单平台</h1>
        <p class="subtitle">
          自动挂机 · 稳定高效 · 24小时不间断运行<br>
          让修仙之路更加轻松
        </p>
        <div class="cta-group">
          ${isLoggedIn
            ? `<button class="btn-hero btn-hero-primary" onclick="location.hash='#/dashboard'">${icon('diamond', 16)} 进入控制台</button>`
            : `
              <button class="btn-hero btn-hero-primary" onclick="location.hash='#/login'">开始使用 ${icon('arrowRight', 14)}</button>
              <button class="btn-hero btn-hero-secondary" onclick="document.querySelector('.landing-features').scrollIntoView({behavior:'smooth'})">了解更多</button>
            `
          }
        </div>
      </section>

      <!-- Features -->
      <section class="landing-features">
        <div class="feature-card">
          <div class="icon">${icon('lightning', 32)}</div>
          <h3>自动升级</h3>
          <p>下单后自动挂机升级至120级，无需手动操作，省时省力</p>
        </div>
        <div class="feature-card">
          <div class="icon">${icon('star', 32)}</div>
          <h3>邀请返利</h3>
          <p>邀请好友注册即享返利，邀请越多返利越高，最高可达70%折扣</p>
        </div>
        <div class="feature-card">
          <div class="icon">${icon('shield', 32)}</div>
          <h3>安全稳定</h3>
          <p>采用反检测技术，多IP轮换，24小时运维监控，保障账号安全</p>
        </div>
        <div class="feature-card">
          <div class="icon">${icon('chart', 32)}</div>
          <h3>实时追踪</h3>
          <p>工单进度实时更新，账号状态一目了然，充值自动到账</p>
        </div>
        <div class="feature-card">
          <div class="icon">${icon('gem', 32)}</div>
          <h3>修仙分系统</h3>
          <p>完成任务获取修仙分，可兑换各类修仙资源与特权服务</p>
        </div>
        <div class="feature-card">
          <div class="icon">${icon('robot', 32)}</div>
          <h3>智能客服</h3>
          <p>7×24小时智能机器人客服，随时解答您的疑问</p>
        </div>
      </section>

      <!-- Pricing -->
      <section class="landing-pricing">
        <h2>${icon('lightning', 20)} 修仙币套餐方案</h2>
        <p style="text-align:center;color:var(--text-secondary);font-size:var(--text-sm);margin-bottom:20px;">购买套餐获取修仙币，可用于坊市交易、兑换修仙资源</p>

        <!-- 现金套餐 -->
        <h3 style="text-align:center;font-size:var(--text-base);font-weight:600;margin-bottom:12px;color:var(--accent-green);">现金套餐（微信支付）</h3>
        <div class="pricing-grid mb-6">
          <div class="pricing-card">
            <div class="title">初入仙途</div>
            <div class="price">¥5</div>
            <div class="desc">2500 修仙币<br>¥5 = 2500 修仙币</div>
          </div>
          <div class="pricing-card">
            <div class="title">小有所成</div>
            <div class="price">¥10</div>
            <div class="desc">5200 修仙币<br>额外赠送200币</div>
          </div>
          <div class="pricing-card featured">
            <div class="title">渐入佳境</div>
            <div class="price">¥15</div>
            <div class="desc">8000 修仙币<br>基础价+额外赠送</div>
          </div>
          <div class="pricing-card">
            <div class="title">炉火纯青</div>
            <div class="price">¥20</div>
            <div class="desc">12000 修仙币<br>性价比更高</div>
          </div>
          <div class="pricing-card">
            <div class="title">登堂入室</div>
            <div class="price">¥30</div>
            <div class="desc">18000 修仙币<br>超值选择</div>
          </div>
          <div class="pricing-card">
            <div class="title">一代宗师</div>
            <div class="price">¥50</div>
            <div class="desc">25000 修仙币<br>最优惠档位</div>
          </div>
        </div>

        <!-- 灵石套餐 -->
        <h3 style="text-align:center;font-size:var(--text-base);font-weight:600;margin-bottom:12px;color:var(--accent-amber);">灵石套餐（游戏内灵石支付）</h3>
        <div class="pricing-grid">
          <div class="pricing-card">
            <div class="title">灵石入门</div>
            <div class="price">500万灵石</div>
            <div class="desc">70 修仙币<br>100万灵石=10修仙币</div>
          </div>
          <div class="pricing-card">
            <div class="title">灵石小成</div>
            <div class="price">1000万灵石</div>
            <div class="desc">150 修仙币<br>量大从优</div>
          </div>
          <div class="pricing-card">
            <div class="title">灵石大成</div>
            <div class="price">3000万灵石</div>
            <div class="desc">400 修仙币<br>超值套餐</div>
          </div>
          <div class="pricing-card featured">
            <div class="title">灵石巅峰</div>
            <div class="price">5000万灵石</div>
            <div class="desc">700 修仙币<br>高性价比</div>
          </div>
          <div class="pricing-card">
            <div class="title">灵石至尊</div>
            <div class="price">1亿灵石</div>
            <div class="desc">1500 修仙币<br>至尊之选</div>
          </div>
        </div>

        <p style="text-align:center;color:var(--text-tertiary);font-size:var(--text-xs);margin-top:16px;">
          基础充值：1元 = 400修仙币，100万灵石 = 10修仙币<br>
          充值后联系站长，审核通过后自动生成兑换码，输入即可到账
        </p>
      </section>

      <!-- QR Codes -->
      <section style="max-width:500px;margin:0 auto;padding:0 24px 40px;">
        <div style="display:flex;gap:24px;justify-content:center;flex-wrap:wrap;">
          <div style="text-align:center;">
            <div style="width:140px;height:140px;border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--border-light);">
              <img src="/src/assets/加v二维码.png" alt="加微信" style="width:100%;height:100%;object-fit:contain;">
            </div>
            <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:6px;">扫码加站长微信</p>
          </div>
          <div style="text-align:center;">
            <div style="width:140px;height:140px;border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--border-light);">
              <img src="/src/assets/支付二维码.png" alt="支付" style="width:100%;height:100%;object-fit:contain;">
            </div>
            <p style="font-size:var(--text-xs);color:var(--text-secondary);margin-top:6px;">扫码支付</p>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="landing-cta">
        <h2>${icon('rocket', 20)} 立即开始您的修仙之旅</h2>
        ${!isLoggedIn ? `
          <div class="cta-group" style="justify-content:center;">
            <button class="btn-hero btn-hero-primary" onclick="location.hash='#/register'">免费注册</button>
            <button class="btn-hero btn-hero-secondary" onclick="location.hash='#/login'">已有账号？登录</button>
          </div>
        ` : `
          <button class="btn-hero btn-hero-primary" onclick="location.hash='#/dashboard'">进入控制台</button>
        `}
      </section>

      <!-- Footer -->
      <footer class="landing-footer">
        <p>艾德尔修仙工单平台 &copy; 2026</p>
        <p style="margin-top:4px;font-size:var(--text-xs);color:var(--text-tertiary);">
          本平台仅作为工单确认执行平台，不具备支付与验证功能
        </p>
        <p style="margin-top:4px;">
          <a href="#/help">帮助文档</a>
          &nbsp;·&nbsp;
          <a href="#/contact">联系站长</a>
        </p>
      </footer>
    </div>`;
}
