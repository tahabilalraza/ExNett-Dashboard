import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { User, Expert, Industry, Sector, Client, Project, Assignment, Activity, Settings } from './models.js';

// Synthetic, repeatable demo initialization. Never resets or reads historical files.
const uri = process.env.MONGODB_URI || config.mongoUri || config.mongodbUri;
if (process.env.NODE_ENV === 'production' || process.env.SEED_DEMO !== 'true' ||
    !/^exnett_demo(?:_[A-Za-z0-9_-]+)?$/.test(new URL(uri).pathname.slice(1))) {
  throw new Error('Demo seed requires SEED_DEMO=true and an exnett_demo database outside production.');
}
await mongoose.connect(uri);
try {
  const passwordHash = await bcrypt.hash('ExNettDemo!2026', 12);
  const users = {};
  for (const [role, name] of [['admin', 'Demo Administrator'], ['manager', 'Demo Operations Manager'], ['member', 'Demo Researcher']]) {
    users[role] = await User.findOneAndUpdate({ email: `${role}@exnett.test` }, {
      $setOnInsert: { name, email: `${role}@exnett.test`, passwordHash, role, active: true },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  const energy = await Industry.findOneAndUpdate({ name: 'Demo · Energy' }, { $setOnInsert: { name: 'Demo · Energy', active: true } }, { upsert: true, new: true });
  const technology = await Industry.findOneAndUpdate({ name: 'Demo · Technology' }, { $setOnInsert: { name: 'Demo · Technology', active: true } }, { upsert: true, new: true });
  const sector = await Sector.findOneAndUpdate({ name: 'Demo · Renewables', industry: energy._id }, { $setOnInsert: { name: 'Demo · Renewables', industry: energy._id, active: true } }, { upsert: true, new: true });
  const client = await Client.findOneAndUpdate({ clientId: 'DEMO-CL-001' }, { $setOnInsert: {
    clientId: 'DEMO-CL-001', clientName: 'Demo Research Partners', status: 'Active',
    primaryContactName: 'Demo Client Contact', primaryContactEmail: 'client@example.test',
    notes: 'Synthetic company for development. No real ExNett client information.',
  } }, { upsert: true, new: true });
  const projectSpecs = [
    ['DEMO-PR-001', 'Demo · Renewable energy outlook', energy, 'Active'],
    ['DEMO-PR-002', 'Demo · Technology adoption', technology, 'Active'],
    ['DEMO-PR-003', 'Demo · Completed market study', energy, 'Completed'],
  ];
  const projects = [];
  for (const [projectId, projectName, industry, status] of projectSpecs) {
    projects.push(await Project.findOneAndUpdate({ projectId }, { $setOnInsert: {
      projectId, projectName, industry: industry._id, client: client._id, owner: users.manager._id,
      status, priority: 'Normal', startDate: new Date(Date.now() - 20 * 86400000),
      deadline: new Date(Date.now() + 12 * 86400000),
      ...(status === 'Completed' ? { completedDate: new Date(Date.now() - 86400000) } : {}),
      description: 'A fictional research project demonstrating the expert assignment workflow.',
    } }, { upsert: true, new: true }));
  }
  const expertSpecs = [
    ['DEMO-EX-001', 'Alex Morgan (Demo)', 'United Kingdom', 'Demo Energy Group', 'Strategy Director', energy, 220, 'GBP'],
    ['DEMO-EX-002', 'Jordan Ellis (Demo)', 'Australia', 'Demo Resources Ltd', 'Operations Lead', energy, 250, 'USD'],
    ['DEMO-EX-003', 'Casey Rivera (Demo)', 'United States', 'Demo Software Inc', 'Technology Advisor', technology, 300, 'USD'],
    ['DEMO-EX-004', 'Taylor Quinn (Demo)', 'Germany', 'Demo Innovation GmbH', 'Research Lead', technology, 180, 'EUR'],
    ['DEMO-EX-005', 'Robin Blake (Demo)', 'Singapore', 'Demo Advisory', 'Independent Consultant', energy, null, null],
    ['DEMO-EX-006', 'Sam Parker (Demo)', 'Canada', '', '', technology, 200, 'USD'],
  ];
  const experts = [];
  for (const [expertId, fullName, country, currentCompany, currentPosition, industry, hourlyRate, currency] of expertSpecs) {
    experts.push(await Expert.findOneAndUpdate({ expertId }, { $setOnInsert: {
      expertId, fullName, country, currentCompany, currentPosition, industry: industry._id,
      ...(industry._id.equals(energy._id) ? { sector: sector._id } : {}),
      email: `${expertId.toLowerCase()}@example.test`, emails: [`${expertId.toLowerCase()}@example.test`],
      status: 'Active', hourlyRate, currency, recruitedBy: users.member._id,
      tags: ['synthetic-demo'], remarks: 'Fictional expert; not a historical ExNett record.',
    } }, { upsert: true, new: true }));
  }
  const memberships = [[0, 0, 'Completed'], [0, 1, 'Screening'], [1, 0, 'Scheduled'], [2, 1, 'Contacted'], [3, 1, 'Added'], [4, 2, 'Completed']];
  for (const [ei, pi, assignmentStatus] of memberships) {
    await Assignment.findOneAndUpdate({ expert: experts[ei]._id, project: projects[pi]._id }, { $setOnInsert: {
      expert: experts[ei]._id, project: projects[pi]._id, assignmentStatus,
      expertRate: experts[ei].hourlyRate, currency: experts[ei].currency,
      assignedAt: new Date(Date.now() - 10 * 86400000), createdBy: users.manager._id,
      ...(assignmentStatus === 'Completed' ? { completedAt: new Date(Date.now() - 86400000) } : {}),
    } }, { upsert: true, new: true });
  }
  const a = await Assignment.findOne({ expert: experts[0]._id, project: projects[0]._id });
  if (!await Activity.exists({ assignment: a._id, notes: 'Synthetic demo consultation.' })) {
    await Activity.create({ expert: experts[0]._id, project: projects[0]._id, assignment: a._id,
      activityType: 'Consultation', activityDate: new Date(Date.now() - 86400000),
      performedBy: users.member._id, outcome: 'Completed', notes: 'Synthetic demo consultation.',
      durationMinutes: 60, clientRate: 400, expertRate: 220, currency: 'GBP',
      billingAmount: 400, revenue: 400, expertCost: 220, margin: 180,
    });
  }
  if (!await Activity.exists({ expert: experts[2]._id, notes: 'Synthetic demo outreach.' })) {
    await Activity.create({ expert: experts[2]._id, project: projects[1]._id,
      activityType: 'Email', activityDate: new Date(), performedBy: users.member._id,
      outcome: 'Awaiting response', notes: 'Synthetic demo outreach.',
    });
  }
  await Settings.findOneAndUpdate({ key: 'organization' }, {
    $setOnInsert: { key: 'organization', organizationName: 'ExNett · Demo workspace', demoMode: true },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  console.log('Synthetic demo initialized. Existing records and passwords were preserved.');
  console.log('Demo users: admin@exnett.test, manager@exnett.test, member@exnett.test');
} finally { await mongoose.disconnect(); }
