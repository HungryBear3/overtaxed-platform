import { readFileSync } from "node:fs";
import { join } from "node:path";

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/ci.yml"),
  "utf8",
);

describe("CI recovery PostgreSQL runtime", () => {
  it("copies package binaries into a root-owned sealed path without relaxing executable trust", () => {
    expect(workflow).toContain("trusted_root=/opt/ot-neutral-postgresql");
    expect(workflow).toContain(
      'sudo install -d -o root -g root -m 0755 "$trusted_root" "$trusted_root/$major" "$destination"',
    );
    expect(workflow).toContain(
      'sudo cp --recursive --dereference --preserve=mode,timestamps "$source/." "$destination/"',
    );
    expect(workflow).toContain(
      'sudo chown --recursive root:root "$trusted_root/$major"',
    );
    expect(workflow).toContain(
      'sudo chmod --recursive go-w "$trusted_root/$major"',
    );
    expect(workflow).toContain(
      'sudo find "$trusted_root/$major" -xdev \\( -type l -o ! -user root -o -perm /022 \\) -print -quit',
    );
    expect(workflow).toContain('local share="/usr/share/postgresql/$major"');
    expect(workflow).toContain("sudo chown root:root /usr/share/postgresql");
    expect(workflow).toContain("sudo chmod go-w /usr/share/postgresql");
    expect(workflow).toContain('sudo chown --recursive root:root "$share"');
    expect(workflow).toContain('sudo chmod --recursive go-w "$share"');
    expect(workflow).toContain(
      'sudo find "$share" -xdev \\( -type l -o ! -user root -o -perm /022 \\) -print -quit',
    );
    expect(workflow).toContain(
      'source_pg_config="$trusted_root/17/bin/pg_config"',
    );
    expect(workflow).toContain(
      'target_pg_config="$trusted_root/${{ matrix.postgres }}/bin/pg_config"',
    );
    expect(workflow).toContain(
      'OT_NEUTRAL_RECOVERY_REHEARSAL_PG_CONFIG="$source_pg_config"',
    );
    expect(workflow).toContain(
      'OT_NEUTRAL_RECOVERY_REHEARSAL_PG_CONFIG="$target_pg_config"',
    );
    expect(workflow).not.toMatch(/NODE_ENV|unitTestTrustedExecutablePolicy/);
  });
});
