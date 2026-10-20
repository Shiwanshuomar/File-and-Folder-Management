const searchInput = document.getElementById('fileSearch');
const sortSelect = document.getElementById('sortFiles');
const fileList = document.getElementById('fileList');
const searchMessage = document.getElementById('searchMessage');
const emptySearch = document.getElementById('emptySearch');

function updateFiles() {
  if (!fileList) return;
  const query = (searchInput?.value || '').trim().toLowerCase();
  const cards = Array.from(fileList.querySelectorAll('.file-card'));
  const sortBy = sortSelect?.value || 'name-asc';

  cards.sort((a, b) => {
    const nameA = a.dataset.name.toLowerCase();
    const nameB = b.dataset.name.toLowerCase();
    if (sortBy === 'name-desc') return nameB.localeCompare(nameA);
    if (sortBy === 'newest') return Number(b.dataset.modified) - Number(a.dataset.modified);
    if (sortBy === 'oldest') return Number(a.dataset.modified) - Number(b.dataset.modified);
    if (sortBy === 'largest') return Number(b.dataset.size) - Number(a.dataset.size);
    return nameA.localeCompare(nameB);
  });

  let visibleCount = 0;
  cards.forEach((card) => {
    const matches = card.dataset.name.toLowerCase().includes(query);
    card.hidden = !matches;
    if (matches) visibleCount++;
    fileList.appendChild(card);
  });

  if (searchMessage) {
    searchMessage.textContent = query ? `${visibleCount} item${visibleCount === 1 ? '' : 's'} found.` : '';
  }
  if (emptySearch) emptySearch.hidden = !(query && visibleCount === 0);
}

searchInput?.addEventListener('input', updateFiles);
sortSelect?.addEventListener('change', updateFiles);
