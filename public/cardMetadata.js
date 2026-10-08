function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function renderCardMetadata(repo) {
  const branch = escapeHtml(repo.git?.branch || 'main');
  const isDirty = repo.git?.isDirty;
  const ahead = Number(repo.git?.ahead) || 0;
  const behind = Number(repo.git?.behind) || 0;
  return `
          <div class="card-metadata text-[11px] text-slate-400">
            <!-- Git Row -->
            <div class="card-git flex items-center justify-between">
              <span class="card-branch flex items-center gap-1 text-slate-400 truncate max-w-[170px]" title="Branch: ${branch}">
                <i class="fa-solid fa-code-branch text-slate-500 text-[10px]"></i>
                <span class="truncate font-mono text-slate-300">${branch}</span>
                ${isDirty ? '<span class="text-[9px] bg-amber-500/20 text-amber-400 px-1 rounded ml-1">modified</span>' : ''}
              </span>
              <div class="flex items-center gap-1 font-mono text-[10px]">
                ${ahead > 0 ? `<span class="text-emerald-400">↑${ahead}</span>` : ''}
                ${behind > 0 ? `<span class="text-rose-400">↓${behind}</span>` : ''}
                ${!ahead && !behind ? `<span class="text-slate-500">synced</span>` : ''}
              </div>
            </div>

            <!-- JDK & Engine -->
            <div class="card-runtime flex items-center justify-between text-slate-400">
              <span class="flex items-center gap-1">
                <i class="fa-brands fa-java text-amber-500/80 text-[10px]"></i>
                <span>${escapeHtml(repo.jdk || 'system')}</span>
              </span>
              <span class="text-[10px] font-mono ${repo.isBuilt ? 'text-slate-400' : 'text-amber-400 font-semibold'}">
                ${repo.isBuilt ? '<i class="fa-solid fa-check text-emerald-400 mr-0.5"></i> Built' : '<i class="fa-solid fa-triangle-exclamation mr-0.5"></i> Needs Build'}
              </span>
            </div>

            <!-- Anti-lag tuning pill -->
            <div class="card-tuning flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
              <span>Anti-Lag: <span class="text-indigo-400">384M / C1 JIT</span></span>
              <span>${escapeHtml((repo.projectType || 'unknown').toUpperCase())}</span>
            </div>
          </div>
  `;
}
