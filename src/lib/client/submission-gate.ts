// One user submission claims the gate until navigation or a handled error.
// A re-render or second submit event cannot start another POST.
export function createSubmissionGate() {
  let active = false;
  return {
    claim(): boolean { if (active) return false; active = true; return true; },
    release(): void { active = false; },
  };
}
