import { CONNECT } from "../brand";
import { CodeTabs } from "../components/CodeTabs";
import { SNIPPET_API_URL, SNIPPET_IS_PLACEHOLDER, SNIPPET_MCP_URL } from "../config";
import { DEVELOPER_PATHS, developerTabs, type DeveloperPathId } from "../data/snippets";
import { CONTRACTS, nearblocksAccount } from "./contracts";

const isPath = (v: string | undefined): v is DeveloperPathId => v !== undefined && (DEVELOPER_PATHS as readonly string[]).includes(v);

/** The code a developer path needs, with the addresses this build shows: JavaScript, Python and curl, or MCP, or the SDK. */
function DeveloperTabs({ path }: { path: string | undefined }) {
  const id = isPath(path) ? path : "ai";
  const tabs = developerTabs(SNIPPET_API_URL, SNIPPET_MCP_URL)[id];
  return (
    <>
      <CodeTabs tabs={tabs} label={`Code for ${id}`} />
      {SNIPPET_IS_PLACEHOLDER && (
        <p className="fine" data-testid="snippet-placeholder">
          {CONNECT.placeholder}
        </p>
      )}
    </>
  );
}

/** The deployed accounts, each linked to its explorer page. */
function ContractsTable() {
  return (
    <div className="scrollx dd-table" role="region" aria-label="Deployed contracts" tabIndex={0}>
      <table className="tbl" data-testid="contracts-table">
        <thead>
          <tr>
            <th>Contract</th>
            <th>Account</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {CONTRACTS.map((c) => (
            <tr key={c.account}>
              <td>
                <b>{c.name}</b>
              </td>
              <td>
                <a className="acct" href={nearblocksAccount(c.account)} target="_blank" rel="noreferrer">
                  {c.account}
                </a>
              </td>
              <td>{c.does}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Embeds a page asks for with a ::name{...} line. An unknown name renders nothing. */
export function Embed({ name, props }: { name: string; props: Record<string, string> }) {
  if (name === "developer-tabs") return <DeveloperTabs path={props.path} />;
  if (name === "contracts") return <ContractsTable />;
  return null;
}
