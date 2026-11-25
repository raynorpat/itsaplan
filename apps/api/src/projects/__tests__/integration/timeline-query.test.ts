import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createInitiative,
  createProject,
  createTeam,
  gqlData,
} from '../../../__tests__/helpers/graphql';
import { countStatements } from '../../../__tests__/helpers/statements';

// The web's projects timeline reads every project with its status, lead, teams,
// initiatives and milestones in one query; those fields load in batches, so the
// query's cost does not grow with the number of projects.

const TIMELINE = `query {
  projects(first: 250) {
    nodes {
      id name startDate targetDate health
      status { type }
      lead { id }
      teams { nodes { id name } }
      initiatives { nodes { id name } }
      projectMilestones { nodes { id name targetDate } }
    }
  }
}`;

describe('projects timeline query', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('runs a fixed number of statements however many projects there are', async () => {
    const owner = await signUpTestUser();
    const eng = await createTeam(owner, { key: 'ENG' });
    const ops = await createTeam(owner, { key: 'OPS' });
    const ini = await createInitiative(owner, { name: 'Roadmap' });

    async function addProjects(n: number, from: number) {
      for (let i = from; i < from + n; i++) {
        const p = await createProject(owner, {
          name: `P${i}`,
          teamIds: [eng.team.id, ops.team.id],
          leadId: owner.userId,
        });
        await gqlData(
          owner,
          `mutation ($input: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $input) { success } }`,
          { input: { projectId: p.id, name: `M${i}` } },
        );
        await gqlData(
          owner,
          `mutation ($input: InitiativeToProjectCreateInput!) { initiativeToProjectCreate(input: $input) { success } }`,
          { input: { initiativeId: ini.id, projectId: p.id } },
        );
      }
    }

    await addProjects(2, 0);
    let read: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    const few = await countStatements(async () => {
      read = await gqlData(owner, TIMELINE);
    });
    expect(read.projects.nodes).toHaveLength(2);
    expect(read.projects.nodes[0].teams.nodes).toHaveLength(2);
    expect(read.projects.nodes[0].initiatives.nodes).toEqual([{ id: ini.id, name: 'Roadmap' }]);
    expect(read.projects.nodes[0].projectMilestones.nodes).toHaveLength(1);
    expect(read.projects.nodes[0].lead).toEqual({ id: owner.userId });

    await addProjects(8, 2);
    const many = await countStatements(async () => {
      read = await gqlData(owner, TIMELINE);
    });
    expect(read.projects.nodes).toHaveLength(10);
    expect(many).toBe(few);
  });
});
