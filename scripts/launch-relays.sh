#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${WARELAY_TMUX_SESSION:-warelay-relay}"
CMD_JOE="pnpm warelay relay --provider discord --verbose --profile joe"
CMD_SHANNON="pnpm warelay relay --provider discord --verbose --profile shannon"

if tmux has-session -t "${SESSION_NAME}" 2>/dev/null; then
  echo "tmux session \"${SESSION_NAME}\" already exists. Attach with: tmux attach -t ${SESSION_NAME}"
  exit 0
fi

tmux new-session -d -s "${SESSION_NAME}" -n joe
tmux send-keys -t "${SESSION_NAME}:0.0" "${CMD_JOE}" Enter
tmux split-window -h -t "${SESSION_NAME}:0"
tmux send-keys -t "${SESSION_NAME}:0.1" "${CMD_SHANNON}" Enter
tmux select-layout -t "${SESSION_NAME}:0" even-horizontal
tmux attach -t "${SESSION_NAME}"
