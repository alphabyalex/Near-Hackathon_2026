# fixtures

Owner: Lucy

| Folder | Committed | Contents |
| --- | --- | --- |
| dev/ | yes | 12 public development scenarios. Tune against these. |
| private/ | **never** (gitignored) | Hidden assessment set and its commitment secrets |
| released-assessment/ | after reveal only | The hidden set, published once we choose to reveal |

## fixtures/private layout (local only)

```
fixtures/private/
  assessment/<scenario_id>.json   48 scenarios: split ASSESSMENT, or FINAL for the last 12
  suite/suite-manifest.json       written by commit:assessment
  suite/suite-salt.hex            written by commit:assessment; opening the commitment needs it
  runs/<run_id>/run-record.json   raw agent output from assessment runs
```

Rules: never commit it, never paste it to teammates, never share it with the agent author.
Keep a backup outside the repo; without the salt the public commitment can never be opened.
