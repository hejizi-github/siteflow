console.log('siteflow fixture loaded');

window.__siteflowFixtureState = {
  count: 0,
};

function siteflowTarget(value) {
  window.__siteflowFixtureState.count += value;
  const marker = 'SITEFLOW_BREAKPOINT_MARKER';
  return `${marker}:${window.__siteflowFixtureState.count}`;
}

async function siteflowFetch() {
  try {
    await fetch('./data.json');
  } catch (error) {
    console.error('fixture fetch failed', error);
  }
}

function siteflowXhr() {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', './data.json');
  xhr.send();
}

async function siteflowCrypto() {
  const bytes = new TextEncoder().encode('siteflow fixture crypto');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 4);
}

document.getElementById('run').addEventListener('click', () => {
  console.log(siteflowTarget(1));
  document.getElementById('status').textContent = 'ran';
  void siteflowFetch();
});

document.getElementById('message').addEventListener('input', event => {
  window.__siteflowFixtureState.message = event.target.value;
  document.getElementById('status').textContent = `message:${event.target.value}`;
});

document.getElementById('mode').addEventListener('click', () => {
  const options = document.getElementById('mode-options');
  const expanded = options.hidden;
  options.hidden = !expanded;
  document.getElementById('mode').setAttribute('aria-expanded', String(expanded));
});

for (const option of document.querySelectorAll('[role="option"]')) {
  option.addEventListener('click', () => {
    window.__siteflowFixtureState.mode = option.textContent;
    document.getElementById('mode').textContent = option.textContent;
    document.getElementById('mode-options').hidden = true;
    document.getElementById('status').textContent = `mode:${option.textContent}`;
  });
}
