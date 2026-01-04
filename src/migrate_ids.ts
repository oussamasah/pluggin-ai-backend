import mongoose from 'mongoose';
import { Session } from './models/Session'; // Import your Session model
import { Company } from './models/Company'; // Import your Company model
import { Employee } from './models/Employee'; // Add others as needed

async function migrateUserId() {
  await mongoose.connect(process.env.MONGODB_URI!);

  // 1. Get all sessions that have a userId
  const sessions = await Session.find({ userId: { $exists: true } });
  console.log(`Found ${sessions.length} sessions to process.`);

  for (const session of sessions) {
    const sId = session._id;
    const uId = session.userId;

    console.log(`Mapping Session ${sId} to User ${uId}...`);

    // 2. Update all companies matching this sessionId
    const companyRes = await Company.updateMany(
      { sessionId: sId, userId: { $exists: false } }, 
      { $set: { userId: uId } }
    );

    // 3. Update all employees matching this sessionId
    // Accessing the collection directly via mongoose.connection for speed
    const employeeRes = await mongoose.connection.db.collection('employees').updateMany(
      { sessionId: sId, userId: { $exists: false } },
      { $set: { userId: uId } }
    );

    console.log(`Updated ${companyRes.modifiedCount} companies and ${employeeRes.modifiedCount} employees.`);
  }

  console.log("Migration Complete!");
  process.exit(0);
}

migrateUserId();