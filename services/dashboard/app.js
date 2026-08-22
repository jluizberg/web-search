const form = document.querySelector('#askForm');
const questionInput = document.querySelector('#question');
const topicInput = document.querySelector('#topic');
const limitInput = document.querySelector('#limit');
const status = document.querySelector('#status');
const emptyState = document.querySelector('#emptyState');
const answerPage = document.querySelector('#answerPage');
const reportQuestion = document.querySelector('#reportQuestion');
const reportDate = document.querySelector('#reportDate');
const answerCopy = document.querySelector('#answerCopy');
const considerations = document.querySelector('#considerations');
const authors = document.querySelector('#authors');
const stakeholders = document.querySelector('#stakeholders');
const references = document.querySelector('#references');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function renderCitations(text) {
  return escapeHtml(text)
    .replace(/\[(\d+)\]/g, '<a href="#reference-$1" aria-label="Go to reference $1">[$1]</a>')
    .split(/\n\s*\n/)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function renderResult(result) {
  emptyState.classList.add('hidden');
  answerPage.classList.remove('hidden');
  reportQuestion.textContent = result.question;
  reportDate.textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  answerCopy.innerHTML = renderCitations(result.answer);
  considerations.innerHTML = result.considerations.length
    ? result.considerations.map(item => `<li>${renderCitations(item).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')
    : '<li>No additional considerations were returned for this question.</li>';
  authors.innerHTML = result.authors.length
    ? result.authors.map(renderAuthor).join('')
    : '<p class="empty-supporting">No authors were identified in the retrieved articles.</p>';
  stakeholders.innerHTML = result.stakeholders.length
    ? result.stakeholders.map(renderStakeholder).join('')
    : '<p class="empty-supporting">No stakeholders were identified in the retrieved articles.</p>';
  references.innerHTML = result.sources.length
    ? result.sources.map(source => `<li id="reference-${source.number}"><cite>${escapeHtml(source.title)}</cite>. ${escapeHtml(source.site)}. <small><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.url)}</a></small></li>`).join('')
    : '<li>No references available.</li>';
}

function renderAuthor(author) {
  const articles = author.involvements.map(item => `
    <div class="involvement">
      <div class="involvement-head"><a href="${escapeHtml(item.articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.articleTitle || item.articleUrl)}</a><span>${escapeHtml(item.relationship || 'Author')}</span></div>
      ${item.rationale ? `<p class="involvement-context">${escapeHtml(item.rationale)}</p>` : ''}
    </div>`).join('');
  return `<section class="stakeholder-card"><div class="stakeholder-title"><div><h3>${escapeHtml(author.name)}</h3><span>${escapeHtml(author.type)}</span></div><span>${author.involvements.length} article${author.involvements.length === 1 ? '' : 's'}</span></div><div class="involvements">${articles}</div></section>`;
}

function renderStakeholder(stakeholder) {
  const details = stakeholder.details || {};
  const profile = [details.summary, details.roles?.length ? `Roles: ${details.roles.join(', ')}` : '', details.official_urls?.length ? `Official sources: ${details.official_urls.join(', ')}` : '']
    .filter(Boolean).join(' ');
  const involvements = stakeholder.involvements.map(item => `
    <div class="involvement">
      <div class="involvement-head"><a href="${escapeHtml(item.articleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.articleTitle || item.articleUrl)}</a><span>${escapeHtml(item.relationship || 'Mentioned')}</span></div>
      <p class="involvement-context">${escapeHtml(item.context || item.mention || 'Mentioned in the article.')}</p>
      <dl class="dimensions">
        <div><dt>Spectrum</dt><dd>${escapeHtml(item.spectrum || 'Not classified')}</dd></div>
        <div><dt>Impact</dt><dd>${escapeHtml(item.impactPolarity || 'Not classified')}</dd></div>
        <div><dt>Time</dt><dd>${escapeHtml(item.temporalDimension || 'Not classified')}</dd></div>
        <div><dt>Non-human</dt><dd>${escapeHtml(item.nonHumanStakeholder || 'None')}</dd></div>
        <div><dt>Salience</dt><dd>${escapeHtml(item.salienceDynamics || 'Not classified')}</dd></div>
      </dl>
      ${item.rationale ? `<p class="rationale"><strong>Rationale:</strong> ${escapeHtml(item.rationale)}</p>` : ''}
    </div>`).join('');
  return `<section class="stakeholder-card"><div class="stakeholder-title"><div><h3>${escapeHtml(stakeholder.name)}</h3><span>${escapeHtml(stakeholder.type)}</span></div><span>${stakeholder.involvements.length} article${stakeholder.involvements.length === 1 ? '' : 's'}</span></div><details><summary>Stakeholder details</summary><div class="stakeholder-details">${escapeHtml(profile || 'No consolidated profile details available.')}</div></details><div class="involvements">${involvements}</div></section>`;
}

async function loadTopics() {
  try {
    const response = await fetch('/api/rag/topics');
    const data = await response.json();
    data.topics.forEach(topic => topicInput.add(new Option(topic, topic)));
  } catch (error) {
    status.textContent = 'Topic filters are unavailable; all collections can still be searched.';
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question) return;
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Searching the archive and preparing a considered response...';
  try {
    const response = await fetch('/api/rag/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, topics: topicInput.value ? [topicInput.value] : [], limit: Number(limitInput.value) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The request failed');
    renderResult(result);
    status.textContent = `${result.sources.length} source${result.sources.length === 1 ? '' : 's'} consulted.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#printButton').addEventListener('click', () => window.print());
loadTopics();
