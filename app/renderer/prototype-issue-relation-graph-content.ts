// PROTOTYPE: invented long-form content so the issue document can be judged on a realistic, crowded page.
// Everything here is made up. HTML is what the Forge would hand back after rendering Markdown.

export const bodies: Record<number, string> = {
  500: `
<h2>背景</h2>
<p>（编造）现在派发只能发给<strong>空闲</strong>的面板。面板正在跑一轮时，派发菜单里的目标是灰的，用户只能等它结束再回来点一次。连续做一串子 issue 时，这个等待占了大部分时间：Agent 做完一个，人要盯着、切回来、再派下一个。</p>
<p>这个 spec 让派发可以<em>排进队列</em>：面板忙时，派发先存下来，等这一轮结束后自动交给会话。</p>
<blockquote><p>目标不是做一个调度器，而是把「做完一个自动接下一个」这件最常见的事变得不用盯。</p></blockquote>

<h2>用户故事</h2>
<ol>
<li>作为开发者，我在面板忙时仍能把 issue 派给它，派发会在本轮结束后开始。</li>
<li>作为开发者，我能在面板托盘上看到每个面板排了几条。</li>
<li>作为开发者，我能撤回一条还没开始的派发。</li>
<li>作为开发者，重开应用后，排着的派发还在。</li>
<li>作为开发者，我能在派发记录里分清「已排队」和「已交给会话」。</li>
</ol>

<h2>不做的事</h2>
<ul>
<li>跨面板的负载均衡，或者自动挑选空闲面板。</li>
<li>给队列排优先级、拖动排序。</li>
<li>面板关闭时把排着的派发转给别的面板（先丢弃，并在记录里标出来）。</li>
</ul>

<h2>行为</h2>
<h3>什么时候算「本轮结束」</h3>
<p>以 terminal-core 发出的 <code>turn-ended</code> 事件为准。恢复会话时这个事件目前会发两次（terminal-core#88），所以取下一条之前要先确认面板确实是空闲的：</p>
<pre><code>onTurnEnded(panel) {
  if (panel.state !== 'idle') return;     // 去重：恢复时会收到两次
  const next = queue.shift(panel.id);
  if (next) deliver(panel, next);
}</code></pre>

<h3>状态</h3>
<table>
<thead><tr><th>状态</th><th>含义</th><th>能否撤回</th></tr></thead>
<tbody>
<tr><td>已排队</td><td>存在主进程里，面板还在忙</td><td>能</td></tr>
<tr><td>已交给会话</td><td>已经写进面板的输入</td><td>不能</td></tr>
<tr><td>已丢弃</td><td>面板在交付前被关掉</td><td>—</td></tr>
</tbody>
</table>

<h3>持久化</h3>
<p>队列跟着工作区状态一起写盘。重开应用时，面板按原 ID 恢复；如果某个面板没能恢复，它的队列整体变成「已丢弃」。</p>

<h2>验收</h2>
<ul>
<li><input type="checkbox" checked disabled> 主进程保存队列（#501）</li>
<li><input type="checkbox" checked disabled> 重开后恢复（#502）</li>
<li><input type="checkbox" disabled> 本轮结束自动取下一条（#503）</li>
<li><input type="checkbox" disabled> 派发菜单「排进队列」（#504）</li>
<li><input type="checkbox" disabled> 托盘显示数量（#505）</li>
<li><input type="checkbox" disabled> 撤回（#506）</li>
<li><input type="checkbox" disabled> 记录区分两种状态（#507）</li>
<li><input type="checkbox" disabled> 验收指南（#508）</li>
</ul>

<h2>开放问题</h2>
<ol>
<li>同一个 issue 被排进两个面板时，要不要提醒？</li>
<li>队列上限是多少？先定 5 条，超出时菜单里禁用并说明原因。</li>
</ol>
`,
  504: `
<p>（编造）面板忙的时候，派发菜单里这个面板现在是灰的。改成显示「排进队列」，点击后派发进入 #501 的队列。</p>
<h3>交互</h3>
<ul>
<li>面板空闲：和现在一样，显示「派发」。</li>
<li>面板忙：显示「排进队列 · 已排 N 条」。</li>
<li>队列已满（5 条）：禁用，悬停说明「这个面板已经排了 5 条」。</li>
</ul>
<h3>实现提示</h3>
<p>菜单的数据来自快照里的 <code>panel.queue.length</code>，不要在渲染进程单独请求。</p>
<pre><code>const label = panel.busy
  ? t('queueDispatch', { count: panel.queue.length })
  : t('dispatch');</code></pre>
<p>验收：在一个忙的面板上排两条，两条都在本轮结束后按顺序开始。</p>
`,
  516: `
<p>（编造）在 Windows 11 上，设置页的搜索框输入第一个字之后就失去焦点，必须再点一次才能继续输入。macOS 上没有这个问题。</p>
<h3>复现</h3>
<ol>
<li>打开设置页。</li>
<li>点击顶部搜索框，输入「字体」。</li>
<li>输入「字」之后，光标消失，「体」没有输进去。</li>
</ol>
<h3>日志</h3>
<pre><code>[renderer] settings: filter changed → "字"
[renderer] settings: section list re-mounted (key changed)
[renderer] focus: document.activeElement = BODY</code></pre>
<p>看起来是过滤后整个列表重新挂载，把搜索框也带着重建了。可能和 IME 组合输入有关：只在中文输入法下出现，英文输入正常。</p>
<h3>环境</h3>
<table>
<thead><tr><th>系统</th><th>输入法</th><th>结果</th></tr></thead>
<tbody>
<tr><td>Windows 11 23H2</td><td>微软拼音</td><td>失焦</td></tr>
<tr><td>Windows 11 23H2</td><td>英文</td><td>正常</td></tr>
<tr><td>macOS 15</td><td>系统拼音</td><td>正常</td></tr>
</tbody>
</table>
`,
};

export const discussions: Record<number, [string, string][]> = {
  500: [
    ['mika', '<p>（编造）面板关掉时队列里的派发怎么办？直接丢弃还是转给别的面板？</p>'],
    [
      'red',
      '<p>（编造）先丢弃，并在派发记录里标成「已丢弃」。转派要回答「转给谁」，这一步我们还没有好答案，放进「不做的事」。</p>',
    ],
    [
      'ollie',
      '<p>（编造）#503 依赖 terminal-core 的 <code>turn-ended</code>，那边 #88 还没合。恢复会话时会收到两次事件，如果不去重，会一次取出两条派发。</p><p>我在 spec 里加了一段伪代码，先检查 <code>panel.state</code>。</p>',
    ],
    ['red', '<p>（编造）好。#503 先挂着等 #88，#504 和 #505 不依赖它，可以先做。</p>'],
    ['mika', '<p>（编造）关于上限：5 条是拍脑袋的吗？我平时一个 spec 拆出来七八个子 issue，想一次全排上。</p>'],
    [
      'red',
      '<p>（编造）是拍的。理由是排得越多，越可能在中途发现前面的做错了，后面的全白跑。先 5 条，看用起来怎么样再调。</p><ul><li>超出时菜单禁用，不弹窗。</li><li>悬停说明原因。</li></ul>',
    ],
    [
      'ollie',
      '<p>（编造）#502 合了之后我试了一下：重开应用时，有一个面板因为工作目录被删了没恢复，它的 3 条派发变成了「已丢弃」，记录里能看到。符合 spec。</p>',
    ],
    ['pat', '<p>（编造）验收指南（#508）能不能等 #506 和 #507 都合了再写？现在写的话撤回那段肯定要改。</p>'],
    ['red', '<p>（编造）可以，#508 已经标成被 #506、#507 阻塞了。</p>'],
  ],
  504: [
    ['mika', '<p>（编造）菜单里「排进队列」和「立即派发」放一起会不会误点？</p>'],
    ['red', '<p>（编造）不会同时出现：面板忙的时候才显示「排进队列」，空闲时只有「派发」。</p>'],
    [
      'ollie',
      '<p>（编造）PR #622 的检查挂在快照测试上：</p><pre><code>✗ dispatch menu › busy panel shows queue count\n  Expected: "排进队列 · 已排 2 条"\n  Received: "排进队列"</code></pre><p>是计数还没从快照里读出来，我来改。</p>',
    ],
    ['mika', '<p>（编造）英文文案用 “Queue (2)” 还是 “Queue · 2 waiting”？后者在窄菜单里会被截断。</p>'],
    ['red', '<p>（编造）用 “Queue (2)”。</p>'],
  ],
  516: [
    ['pat', '<p>（编造）我这边 Windows 10 也能复现，同样只在中文输入法下。</p>'],
    [
      'ollie',
      '<p>（编造）应该是 <code>compositionstart</code> 期间我们就更新了过滤结果。列表的 key 用了过滤后的第一项，结果一变 key 就变了，整个区域重挂载。</p><p>两个改法：</p><ol><li>组合输入结束（<code>compositionend</code>）后才过滤。</li><li>key 不再依赖过滤结果。</li></ol><p>我倾向第 2 个，第 1 个只是绕开。</p>',
    ],
    ['red', '<p>（编造）同意第 2 个。顺便加一个组件测试，模拟组合输入。</p>'],
  ],
};
