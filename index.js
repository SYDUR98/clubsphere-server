const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const app = express();
require("dotenv").config();

const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

// var serviceAccount = require("./club-sphere-app-firebase-adminsdk.json");

// const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
// const serviceAccount = JSON.parse(decoded);

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Verify Firebase Token
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).send({ message: "unauthorized access" });

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};
// mongodb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.chduhq7.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware
app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("club sphere sarver working!");
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("club-sphere-db");
    const userCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");
    const eventsCollection = db.collection("events");
    const paymentCollection = db.collection("payments");
    const membershipsCollection = db.collection("memberships");
    const eventRegistrationsCollection = db.collection("eventRegistrations");

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Verify Manager
    const verifyManager = async (req, res, next) => {
      try {
        const email = req.decoded_email;
        const user = await userCollection.findOne({ email });

        if (!user || (user.role !== "manager" && user.role !== "clubManager")) {
          return res.status(403).send({ message: "forbidden access" });
        }

        next();
      } catch (err) {
        console.error("verifyManager error:", err);
        res.status(500).send({ message: "server error" });
      }
    };

    // Verify Mambership
    const verifyMember = async (req, res, next) => {
      try {
        const email = req.decoded_email;
        const user = await userCollection.findOne({ email });

        if (!user || user.role !== "member") {
          return res
            .status(403)
            .send({ message: "Forbidden access: Not a member" });
        }

        next();
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Server error" });
      }
    };

    //=============================================================================
    //                  user related APIs
    //=============================================================================
    // add users
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "member";
      user.createAt = new Date();
      const exists = await userCollection.findOne({ email: user.email });
      if (exists) return res.send({ message: "user exists" });
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    //================================================================================
    //              Display apis
    //================================================================================

    app.get("/clubs/display", async (req, res) => {
      try {
        const {
          search = "",
          category = "",
          location = "",
          sortBy = "newest",
        } = req.query;

        // Build query object
        const query = { status: "approved" };
        if (search) query.clubName = { $regex: search, $options: "i" };
        if (category) query.category = { $regex: category, $options: "i" };
        if (location) query.location = { $regex: location, $options: "i" };

        // Sorting
        let sort = {};
        if (sortBy === "newest") sort = { createdAt: -1 };
        else if (sortBy === "oldest") sort = { createdAt: 1 };
        else if (sortBy === "highestFee") sort = { membershipFee: -1 };
        else if (sortBy === "lowestFee") sort = { membershipFee: 1 };

        const clubs = await clubsCollection.find(query).sort(sort).toArray();

        res.send(clubs);
      } catch (err) {
        console.error("Fetch clubs error:", err);
        res.status(500).send({ message: "Failed to fetch clubs" });
      }
    });

    app.post("/clubs/join/:clubId", verifyFBToken, async (req, res) => {
      try {
        const { clubId } = req.params;
        const userEmail = req.decoded_email;

        if (!userEmail) {
          return res.status(400).send({ message: "User email required" });
        }

        if (!ObjectId.isValid(clubId)) {
          return res.status(400).send({ message: "Invalid clubId" });
        }

        const club = await clubsCollection.findOne({
          _id: new ObjectId(clubId),
        });

        if (!club) {
          return res.status(404).send({ message: "Club not found" });
        }

        const fee = Number(club.membershipFee) || 0;

        // Check if already a member
        const existingMembership = await membershipsCollection.findOne({
          userEmail,
          clubId: club._id,
          status: "active",
        });

        if (existingMembership) {
          return res
            .status(400)
            .send({ message: "You are already a member of this club" });
        }

        if (fee === 0) {
          const membership = await membershipsCollection.insertOne({
            userEmail,
            clubId: club._id,
            status: "active",
            joinedAt: new Date(),
          });

          return res.send({
            message: "Joined free club successfully",
            membership,
          });
        }

        // Paid club → create Stripe session
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: club.clubName,
                },
                unit_amount: fee * 100, // cents
              },
              quantity: 1,
            },
          ],
          metadata: {
            userEmail,
            clubId: club._id.toString(),
            type: "club_membership",
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error("Join club error:", err);
        res
          .status(500)
          .send({ message: "Join club failed", error: err.message });
      }
    });

    //------------------------------------------------------------------------------

    // Get all events for a specific club PROTECTED
    app.get(
      "/clubs/:clubId/events",
      verifyFBToken,

      async (req, res) => {
        const { clubId } = req.params;
        const userEmail = req.decoded_email;

        if (!ObjectId.isValid(clubId)) {
          return res.status(400).send({ message: "Invalid club ID" });
        }

        try {
          // Check membership first
          const member = await membershipsCollection.findOne({
            clubId: new ObjectId(clubId),
            userEmail,
            status: "active",
          });

          if (!member) {
            return res.status(403).send({
              message:
                "Forbidden: You must be an active member to view club events.",
            });
          }

          // Fetch events for the club
          const events = await eventsCollection
            .find({ clubId: new ObjectId(clubId) })
            .sort({ eventDate: 1 })
            .toArray();

          // For each event, compute registration count and whether current user registered
          const result = await Promise.all(
            events.map(async (ev) => {
              const regCount =
                await eventRegistrationsCollection.countDocuments({
                  eventId: ev._id,
                  status: { $ne: "cancelled" },
                });

              const userReg = await eventRegistrationsCollection.findOne({
                eventId: ev._id,
                userEmail,
              });

              return {
                ...ev,
                registrationCount: regCount,
                isRegistered: !!userReg,
              };
            })
          );

          res.send(result);
        } catch (err) {
          console.error("Protected events error:", err);
          res.status(500).send({ message: "Failed to fetch club events" });
        }
      }
    );

    // Register for an Event (PROTECTED)
    app.post("/events/register/:id", verifyFBToken, async (req, res) => {
      try {
        const eventId = req.params.id;
        const userEmail = req.decoded_email; 

        if (!userEmail) {
          return res
            .status(401)
            .send({ message: "Unauthorized: User email missing from token." });
        }

        const event = await eventsCollection.findOne({
          _id: new ObjectId(eventId),
        });
        if (!event) {
          return res.status(404).send({ message: "Event not found." });
        }

        // 1. Check membership for event club
        const member = await membershipsCollection.findOne({
          userEmail,
          clubId: event.clubId,
          status: "active",
        });

        if (!member) {
          return res.status(403).send({
            message:
              "Forbidden: You must be an active member of the club to register for this event.",
          });
        }

        // 2. Check for duplicate registration
        const existingRegistration = await eventRegistrationsCollection.findOne(
          {
            eventId: new ObjectId(eventId),
            userEmail: userEmail,
            status: { $ne: "cancelled" },
          }
        );

        if (existingRegistration) {
          return res
            .status(400)
            .send({ message: "You are already registered for this event." });
        }

        // 3. Free Event Logic
        if (!event.isPaid || event.eventFee === 0) {
          await eventRegistrationsCollection.insertOne({
            eventId: new ObjectId(eventId),
            clubId: event.clubId,
            userEmail: userEmail,
            status: "registered",
            registeredAt: new Date(),
          });
          return res.send({
            message: "Successfully registered for the free event.",
          });
        }

        // 4. Paid Event Logic (Stripe Session Creation)
        const feeInCents = Math.round(event.eventFee * 100);

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `Event Registration: ${event.title}`,
                },
                unit_amount: feeInCents,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.SITE_DOMAIN}/dashboard/event/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/events/${eventId}?status=cancel`,
          metadata: {
            userEmail,
            eventId: event._id.toString(),
            clubId: event.clubId.toString(),
            type: "event_registration",
          },
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error("Event registration error:", err);
        res
          .status(500)
          .send({ message: "Internal server error during registration." });
      }
    });

    //-------------------------------------------------------------------------------

    // Payment success
    app.post("/payments/confirm", async (req, res) => {
      const { sessionId } = req.body;

      if (!sessionId)
        return res.status(400).send({ message: "Missing sessionId" });

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed" });
        }

        const { userEmail, clubId } = session.metadata;
        const amount = session.amount_total / 100;

        // Check if already paid
        const existingPayment = await paymentCollection.findOne({
          transactionId: session.id,
        });
        if (existingPayment) {
          return res.send({ message: "Payment already confirmed" });
        }

        // Save payment
        const payment = await paymentCollection.insertOne({
          userEmail,
          clubId,
          transactionId: session.id,
          amount,
          status: "success",
          createdAt: new Date(),
        });

        // Create membership
        const membership = await membershipsCollection.insertOne({
          userEmail,
          clubId: new ObjectId(clubId),
          status: "active",
          joinedAt: new Date(),
        });

        res.send({
          message: "Payment confirmed & club joined",
          payment,
          membership,
        });
      } catch (err) {
        console.error("Payment confirm error:", err);
        res
          .status(500)
          .send({ message: "Payment confirmation failed", error: err.message });
      }
    });

    // Check membership
    app.get("/clubs/is-member", async (req, res) => {
      const { userEmail, clubId } = req.query;
      if (!userEmail || !clubId) return res.send({ isMember: false });

      const member = await membershipsCollection.findOne({
        userEmail,
        clubId: new ObjectId(clubId),
      });
      res.send({ isMember: !!member });
    });

    //*****************details apis******************** */
    // GET single club details
    app.get("/clubs/:id/details", async (req, res) => {
      const id = req.params.id;
      const club = await clubsCollection.findOne({ _id: new ObjectId(id) });
      if (!club) return res.status(404).send({ message: "Club not found" });

      const upcomingCount = await eventsCollection.countDocuments({
        clubId: new ObjectId(id),
        eventDate: { $gte: new Date() },
      });

      res.send({ ...club, upcomingEventsCount: upcomingCount });
    });

    //================================================================================
    //                    Admin apis
    //================================================================================
    // Admin Stats API

    app.get("/admin/stats", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        // Total Counts
        const totalUsers = await userCollection.countDocuments();
        const totalClubs = await clubsCollection.countDocuments();
        const pendingClubs = await clubsCollection.countDocuments({
          status: "pending",
        });
        const approvedClubs = await clubsCollection.countDocuments({
          status: "approved",
        });
        const rejectedClubs = await clubsCollection.countDocuments({
          status: "rejected",
        });
        const totalEvents = await eventsCollection.countDocuments();

        // Total Payments
        const revenueResult = await paymentCollection
          .aggregate([
            { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
          ])
          .toArray();
        const totalPayments =
          revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        // Payments Over Last 6 Months
        const paymentsOverTime = await paymentCollection
          .aggregate([
            {
              $group: {
                _id: {
                  month: { $month: "$createdAt" },
                  year: { $year: "$createdAt" },
                },
                amount: { $sum: "$amount" },
              },
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
            { $limit: 6 },
          ])
          .toArray();

        // Memberships per Club
        const membershipsPerClubAgg = await membershipsCollection
          .aggregate([{ $group: { _id: "$clubId", count: { $sum: 1 } } }])
          .toArray();

        // Lookup club names
        const membershipsPerClub = await Promise.all(
          membershipsPerClubAgg.map(async (item) => {
            const club = await clubsCollection.findOne({ _id: item._id });
            return { clubName: club?.clubName || "Unknown", count: item.count };
          })
        );

        // Top 5 clubs by members
        const top5Clubs = [...membershipsPerClub]
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        res.send({
          totalUsers,
          totalClubs,
          pendingClubs,
          approvedClubs,
          rejectedClubs,
          totalEvents,
          totalPayments,
          paymentsOverTime: paymentsOverTime.map((p) => ({
            month: p._id.month,
            year: p._id.year,
            amount: p.amount,
          })),
          membershipsPerClub,
          top5Clubs,
          clubStatusDistribution: {
            pending: pendingClubs,
            approved: approvedClubs,
            rejected: rejectedClubs,
          },
        });
      } catch (err) {
        console.error("Admin stats error:", err);
        res.status(500).send({ message: "Stats loading failed" });
      }
    });

    // admin get all users
    app.get("/users", async (req, res) => {
      try {
        const users = await userCollection.find().toArray();
        res.send(users);
      } catch (err) {
        res.status(500).send({ message: "Failed to load users" });
      }
    });

    //amin change role
    app.patch("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;

      try {
        const result = await userCollection.updateOne(
          { email },
          { $set: { role } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Role update failed" });
      }
    });

    //  delete user -> amdin
    app.delete("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const result = await userCollection.deleteOne({ email });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Delete failed" });
      }
    });

    // Get all clubs (Admin)
    app.get("/admin/clubs", async (req, res) => {
      try {
        const result = await clubsCollection.find().toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch clubs" });
      }
    });

    // Approve or Reject club -> admni
    app.patch("/admin/clubs/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body; // 'approved' or 'rejected'

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID" });
        }

        const result = await clubsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: status,
              updatedAt: new Date(),
            },
          }
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to update status" });
      }
    });

    // GET all payments for admin
    app.get("/admin/payments", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const payments = await paymentCollection
          .aggregate([
            {
              $addFields: {
                clubIdObj: {
                  $cond: {
                    if: { $eq: ["$clubId", null] },
                    then: null,
                    else: { $toObjectId: "$clubId" },
                  },
                },
              },
            },
            {
              $lookup: {
                from: "clubs",
                localField: "clubIdObj",
                foreignField: "_id",
                as: "clubInfo",
              },
            },
            {
              $unwind: { path: "$clubInfo", preserveNullAndEmptyArrays: true },
            },
            {
              $project: {
                userEmail: 1,
                amount: 1,
                type: 1,
                clubName: "$clubInfo.clubName",
                createdAt: 1,
              },
            },
            { $sort: { createdAt: -1 } },
          ])
          .toArray();

        res.status(200).json(payments);
      } catch (error) {
        console.error("Error fetching payments:", error);
        res.status(500).json({ message: "Failed to fetch payments" });
      }
    });

    //================================================================================
    //              Manager apis
    //================================================================================
    // Manager overview: number of clubs manager manages,
    app.get(
      "/manager/overview",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;
          if (!managerEmail)
            return res.status(401).send({ message: "Unauthorized" });

          //  clubs managed by this manager
          const clubs = await clubsCollection
            .find({ managerEmail })
            .project({ _id: 1 })
            .toArray();
          const clubObjectIds = clubs.map((c) => c._id);
          const clubStringIds = clubs.map((c) => c._id.toString());

          const numberOfClubs = clubs.length;

          if (numberOfClubs === 0) {
            return res.send({
              numberOfClubs: 0,
              totalMembers: 0,
              totalEvents: 0,
              totalPaymentsReceived: 0,
            });
          }

          const totalMembers = await membershipsCollection.countDocuments({
            clubId: { $in: clubObjectIds },
            status: "active",
          });

          const totalEvents = await eventsCollection.countDocuments({
            clubId: { $in: clubObjectIds },
          });

          const paymentsAgg = await paymentCollection
            .aggregate([
              {
                $match: {
                  $and: [
                    { status: "success" },
                    {
                      $or: [
                        { clubId: { $in: clubStringIds } }, // stored as string
                        { clubId: { $in: clubObjectIds } }, // stored as ObjectId
                      ],
                    },
                  ],
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$amount" },
                  count: { $sum: 1 },
                },
              },
            ])
            .toArray();

          const totalPaymentsReceived =
            paymentsAgg.length > 0 ? paymentsAgg[0].total : 0;

          return res.send({
            numberOfClubs,
            totalMembers,
            totalEvents,
            totalPaymentsReceived,
          });
        } catch (err) {
          console.error("Manager overview error:", err);
          res.status(500).send({
            message: "Failed to load manager overview",
            error: err.message,
          });
        }
      }
    );

    //-------------------------------------------------------------------------------------

    //nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn

    // CreateClub -> Page

    app.post("/clubs", verifyFBToken, verifyManager, async (req, res) => {
      try {
        let {
          clubName,
          description,
          category,
          location,
          bannerImage,
          membershipFee,
        } = req.body;

        // Normalize / trim inputs
        clubName = (clubName || "").toString().trim();
        description = (description || "").toString().trim();
        category = (category || "").toString().trim();
        location = (location || "").toString().trim();
        bannerImage = (bannerImage || "").toString().trim();

        // Basic validation
        if (!clubName || !description || !category || !location) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // membershipFee safe conversion (default 0)
        const fee =
          membershipFee === undefined ||
          membershipFee === null ||
          membershipFee === ""
            ? 0
            : Number(membershipFee);

        if (isNaN(fee) || fee < 0) {
          return res.status(400).json({ message: "Invalid membership fee" });
        }

        const newClub = {
          clubName,
          description,
          category,
          location,
          bannerImage: bannerImage || null,
          membershipFee: fee,
          managerEmail: req.decoded_email, // set by verifyFBToken
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await clubsCollection.insertOne(newClub);

        res.status(201).json({
          message: "Club created (Pending Admin Approval)",
          clubId: result.insertedId,
        });
      } catch (err) {
        console.error("Create club error:", err);
        res.status(500).json({ message: "Failed to create club" });
      }
    });

    // GET /clubs/my - Fetch manager's own clubs
    app.get("/clubs/my", verifyFBToken, verifyManager, async (req, res) => {
      try {
        const managerEmail = req.decoded_email;

        if (!managerEmail) {
          return res
            .status(401)
            .json({ message: "Unauthorized: manager email missing" });
        }

        // Fetch all clubs created by this manager
        const clubs = await clubsCollection
          .find({ managerEmail })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(clubs);
      } catch (err) {
        console.error("Fetch manager clubs error:", err);
        res.status(500).json({ message: "Failed to fetch clubs" });
      }
    });

    app.patch("/clubs/:id", verifyFBToken, verifyManager, async (req, res) => {
      try {
        const id = req.params.id;
        const managerEmail = req.decoded_email;

        // Validate ID
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid club ID" });
        }

        const clubObjectId = new ObjectId(id);

        // Build filter: only allow the manager who owns the club
        const filter = { _id: clubObjectId, managerEmail };

        // Prepare update document
        const updateFields = { ...req.body };

        // Prevent critical fields from being updated
        delete updateFields._id;
        delete updateFields.createdAt;
        delete updateFields.status;
        delete updateFields.managerEmail; // cannot change owner email

        // Attach updatedAt timestamp
        updateFields.updatedAt = new Date();

        const updateDoc = { $set: updateFields };

        const result = await clubsCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ message: "Club not found or access denied" });
        }

        res.json({ message: "Club updated successfully" });
      } catch (err) {
        console.error("Update club error:", err);
        res.status(500).json({ message: "Failed to update club" });
      }
    });

    // CreateEvent page
    app.post("/events", verifyFBToken, verifyManager, async (req, res) => {
      try {
        const {
          title,
          description,
          eventDate,
          location,
          isPaid,
          eventFee,
          clubId,
          maxAttendees,
        } = req.body;

        const managerEmail = req.decoded_email;

        // Validate required fields
        if (
          !title ||
          !description ||
          !eventDate ||
          !location ||
          !clubId ||
          !ObjectId.isValid(clubId)
        ) {
          return res
            .status(400)
            .json({ message: "Missing or invalid required fields" });
        }

        const clubObjectId = new ObjectId(clubId);

        // Ensure manager owns the club
        const club = await clubsCollection.findOne({
          _id: clubObjectId,
          managerEmail, // only manager of this club can create event
        });

        if (!club) {
          return res.status(403).json({
            message: "Forbidden: Club not approved or not managed by you.",
          });
        }

        // Prepare new event
        const newEvent = {
          title: title.toString().trim(),
          description: description.toString().trim(),
          eventDate: new Date(eventDate),
          location: location.toString().trim(),
          isPaid: !!isPaid,
          eventFee: isPaid ? Number(eventFee) : 0,
          maxAttendees: maxAttendees ? Number(maxAttendees) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
          clubId: clubObjectId,
          clubName: club.clubName,
          managerEmail,
        };

        const result = await eventsCollection.insertOne(newEvent);

        res.status(201).json({
          message: "Event created",
          eventId: result.insertedId,
        });
      } catch (err) {
        console.error("Create event error:", err);
        res.status(500).json({ message: "Failed to create event" });
      }
    });

    app.patch("/events/:id", verifyFBToken, verifyManager, async (req, res) => {
      try {
        const id = req.params.id;
        const managerEmail = req.decoded_email;

        // Validate ID
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid event ID" });
        }

        const eventObjectId = new ObjectId(id);

        // Filter: ensure manager owns the event
        const filter = { _id: eventObjectId, managerEmail };

        // Build update object
        const updateData = { ...req.body };

        // Prevent updating critical fields
        delete updateData._id;
        delete updateData.createdAt;
        delete updateData.clubId;
        delete updateData.clubName;
        delete updateData.managerEmail;

        // Handle specific fields
        if (updateData.eventDate)
          updateData.eventDate = new Date(updateData.eventDate);
        if (updateData.isPaid !== undefined) {
          updateData.isPaid = !!updateData.isPaid;
          updateData.eventFee = updateData.isPaid
            ? Number(updateData.eventFee || 0)
            : 0;
        }
        if (updateData.maxAttendees !== undefined) {
          updateData.maxAttendees = updateData.maxAttendees
            ? Number(updateData.maxAttendees)
            : null;
        }

        // Always update updatedAt
        updateData.updatedAt = new Date();

        const result = await eventsCollection.updateOne(filter, {
          $set: updateData,
        });

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ message: "Event not found or access denied" });
        }

        res.json({ message: "Event updated successfully" });
      } catch (err) {
        console.error("Update event error:", err);
        res.status(500).json({ message: "Failed to update event" });
      }
    });

    //manager apis
    app.get(
      "/manager/all/events",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;

          // Find all events created by manager's clubs
          const events = await eventsCollection
            .find({ managerEmail })
            .sort({ eventDate: 1 })
            .toArray();

          res.status(200).json(events);
        } catch (err) {
          console.error("Manager events error:", err);
          res.status(500).json({ message: "Failed to fetch events" });
        }
      }
    );
    // show event
    app.delete(
      "/manager/all/events/:id",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const { id } = req.params;
          const result = await eventsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount === 1) {
            res.status(200).json({ message: "Event deleted successfully" });
          } else {
            res.status(404).json({ message: "Event not found" });
          }
        } catch (err) {
          console.error(err);
          res.status(500).json({ message: "Failed to delete event" });
        }
      }
    );

    app.patch(
      "/manager/all/events/:id",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;

          const result = await eventsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
          );

          if (result.modifiedCount === 1) {
            res.status(200).json({ message: "Event updated successfully" });
          } else {
            res
              .status(404)
              .json({ message: "Event not found or no changes made" });
          }
        } catch (err) {
          console.error(err);
          res.status(500).json({ message: "Failed to update event" });
        }
      }
    );

    //nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn

    // Get My Clubs
    app.get(
      "/clubs/manager/:email",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        const email = req.params.email;
        const result = await clubsCollection
          .find({ managerEmail: email })
          .toArray();
        res.send(result);
      }
    );

    // delete pais
    app.delete("/clubs/:id", verifyFBToken, verifyManager, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await clubsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Delete failed" });
      }
    });

    // GET /events/my  (Events created by the manager)
    app.get("/events/my", verifyFBToken, verifyManager, async (req, res) => {
      try {
        const managerEmail = req.decoded_email;
        if (!managerEmail)
          return res
            .status(401)
            .json({ message: "Unauthorized: manager email missing" });

        const events = await eventsCollection
          .find({ managerEmail })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).json(events);
      } catch (err) {
        console.error("Fetch manager events error:", err);
        res
          .status(500)
          .json({ message: "Failed to fetch events", error: err.message });
      }
    });

    // delete events
    // app.delete("/events/:id", async (req, res) => {
    //   try {
    //     const id = req.params.id;
    //     const query = { _id: new ObjectId(id) };
    //     const result = await eventsCollection.deleteOne(query);
    //     res.send(result);
    //   } catch (err) {
    //     res.status(500).send({ message: "Delete failed" });
    //   }
    // });

    // Update Event
    app.patch("/events/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const data = { ...req.body };

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid event ID" });
        }

        // Remove _id if accidentally sent
        delete data._id;

        // Type conversion
        if (data.eventDate) data.eventDate = new Date(data.eventDate);
        if (data.isPaid !== undefined) data.isPaid = !!data.isPaid;
        if (data.eventFee) data.eventFee = Number(data.eventFee);
        if (data.maxAttendees) data.maxAttendees = Number(data.maxAttendees);

        const result = await eventsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...data, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Event not found" });
        }

        res.status(200).json({ message: "Event updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Update failed", error: err.message });
      }
    });
    //************************************12 apis************************************ */
    // GET /manager/members
    app.get(
      "/manager/members",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;
          if (!managerEmail)
            return res.status(401).send({ message: "Unauthorized" });

          // 1) clubs managed by this manager
          const clubs = await clubsCollection
            .find({ managerEmail })
            .project({ _id: 1, clubName: 1 })
            .toArray();
          if (!clubs || clubs.length === 0) return res.send([]);

          const clubIds = clubs.map((c) => c._id);

          // 2) memberships for those clubs
          const memberships = await membershipsCollection
            .find({ clubId: { $in: clubIds } })
            .toArray();
          if (!memberships || memberships.length === 0) return res.send([]);

          // 3) enrich with user info and clubName
          const result = await Promise.all(
            memberships.map(async (m) => {
              const user = await userCollection.findOne({ email: m.userEmail });
              const club =
                clubs.find((c) => c._id.toString() === m.clubId?.toString()) ||
                (await clubsCollection.findOne({ _id: m.clubId }));

              return {
                membershipId: m._id,
                clubId: m.clubId,
                clubName: club?.clubName || "Unknown Club",
                memberEmail: m.userEmail,
                memberName: user?.name || user?.displayName || null,
                status: m.status,
                joinedAt: m.joinedAt,
              };
            })
          );

          res.send(result);
        } catch (err) {
          console.error("Manager members error:", err);
          res
            .status(500)
            .send({ message: "Failed to load members", error: err.message });
        }
      }
    );

    // PATCH /memberships/:id
    app.patch(
      "/memberships/:id",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { status } = req.body;

          if (!ObjectId.isValid(id))
            return res.status(400).send({ message: "Invalid membership id" });
          if (!status)
            return res.status(400).send({ message: "Missing status" });

          const membership = await membershipsCollection.findOne({
            _id: new ObjectId(id),
          });
          if (!membership)
            return res.status(404).send({ message: "Membership not found" });

          // verify manager owns the club
          const club = await clubsCollection.findOne({
            _id: membership.clubId,
          });
          if (!club) return res.status(404).send({ message: "Club not found" });
          if (club.managerEmail !== req.decoded_email) {
            return res
              .status(403)
              .send({ message: "Forbidden: you do not manage this club" });
          }

          const result = await membershipsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status, updatedAt: new Date() } }
          );

          res.send({ message: "Membership updated", result });
        } catch (err) {
          console.error("Update membership error:", err);
          res
            .status(500)
            .send({ message: "Update failed", error: err.message });
        }
      }
    );

    //================================================================================
    //              Member apis
    //================================================================================

    // event apis
    app.get("/member/events", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (!userEmail) {
          return res.status(400).send({ message: "User email is required." });
        }

        const memberships = await membershipsCollection
          .find({
            userEmail,
            status: "active",
          })
          .toArray();

        const clubIds = memberships.map((m) => m.clubId);

        console.log("Active Member Email:", userEmail);
        console.log("Active Club IDs:", clubIds);

        if (clubIds.length === 0) {
          return res.send([]);
        }

        const events = await eventsCollection
          .find({
            clubId: { $in: clubIds },
            eventDate: { $gte: new Date() },
          })
          .toArray();

        console.log("Fetched Future Events Count:", events.length);

        const finalEvents = await Promise.all(
          events.map(async (event) => {
            const club = await clubsCollection.findOne({ _id: event.clubId });

            const registration = await eventRegistrationsCollection.findOne({
              eventId: event._id,
              userEmail: userEmail,
            });

            return {
              ...event,
              clubName: club?.clubName || "Unknown Club",
              isRegistered: !!registration,
            };
          })
        );

        res.send(finalEvents);
      } catch (err) {
        console.error("Member events error:", err);
        res.status(500).send({ message: "Failed to load events" });
      }
    });

    // Confirms Event Registration Payment
    app.post(
      "/payments/confirm/event",
      verifyFBToken,
      verifyMember,
      async (req, res) => {
        const { sessionId } = req.body;

        if (!sessionId)
          return res.status(400).send({ message: "Missing sessionId" });

        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId); // Validate payment status

          if (
            session.payment_status !== "paid" ||
            session.metadata.type !== "event_registration"
          ) {
            return res
              .status(400)
              .send({ message: "Payment not completed or wrong type" });
          }

          const { userEmail, eventId, clubId } = session.metadata;
          const amount = session.amount_total / 100; // Prevent duplicate payment entry

          const existingPayment = await paymentCollection.findOne({
            transactionId: session.id,
          });
          if (existingPayment) {
            return res.send({ message: "Event payment already confirmed" });
          } // 1. Save payment record

          await paymentCollection.insertOne({
            userEmail,
            clubId,
            eventId,
            transactionId: session.id,
            amount,
            type: "event",
            status: "success",
            createdAt: new Date(),
          }); 

          const registration = await eventRegistrationsCollection.insertOne({
            userEmail,
            clubId: new ObjectId(clubId),
            eventId: new ObjectId(eventId),
            status: "registered",
            registeredAt: new Date(),
            paymentId: session.id,
          });

          res.send({
            message: "Event payment confirmed & registration complete",
            registration,
          });
        } catch (err) {
          console.error("Event Payment confirm error:", err);
          res.status(500).send({
            message: "Event payment confirmation failed",
            error: err.message,
          });
        }
      }
    );

    // member status

    app.get("/member/stats", verifyFBToken, verifyMember, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        if (!userEmail) {
          return res.status(400).send({ message: "User email is required." });
        }

        const totalClubsJoined = await membershipsCollection.countDocuments({
          userEmail,
          status: "active",
        });

        const totalEventsRegistered =
          await eventRegistrationsCollection.countDocuments({
            userEmail,
            status: "registered",
          });

        const revenueResult = await paymentCollection
          .aggregate([
            { $match: { userEmail, status: "success" } },
            {
              $group: {
                _id: null,
                totalSpent: { $sum: "$amount" },
              },
            },
          ])
          .toArray();

        const totalSpent =
          revenueResult.length > 0 ? revenueResult[0].totalSpent : 0;

        res.send({
          totalClubsJoined,
          totalEventsRegistered,
          totalSpent: totalSpent.toFixed(2),
        });
      } catch (err) {
        console.error("Member stats error:", err);
        res.status(500).send({ message: "Failed to load member stats" });
      }
    });

    app.get("/member/clubs", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email || req.decoded_email;

        if (!userEmail)
          return res
            .status(401)
            .send({ message: "Unauthorized: User email required." });

        const memberships = await membershipsCollection
          .find({ userEmail, status: "active" })
          .toArray();

        if (memberships.length === 0) return res.send([]);

        const uniqueMemberships = [];
        const seen = new Set();
        memberships.forEach((m) => {
          const cid = String(m.clubId);
          if (!seen.has(cid)) {
            uniqueMemberships.push(m);
            seen.add(cid);
          }
        });

        const joinedClubs = await Promise.all(
          uniqueMemberships.map(async (m) => {
           
            let clubIdentifier;

           
            if (m.clubId instanceof ObjectId) {
              clubIdentifier = m.clubId;
            }
          
            else {
              try {
                clubIdentifier = new ObjectId(m.clubId);
              } catch (e) {
               
                clubIdentifier = String(m.clubId);
              }
            }

           
            const club = await clubsCollection.findOne({
              _id: clubIdentifier, 
            });


            let queryClubId;
            if (club?._id) {
             
              queryClubId = club._id;
            } else {
           
              queryClubId = String(m.clubId);
            }

           
            const upcomingCount = await eventsCollection.countDocuments({
              clubId: queryClubId, 
              eventDate: { $gte: new Date() },
            });

            if (!club) return null;

            // Final response object
            return {
              membershipId: m._id.toString(),
              status: m.status || "active",
              joinedAt: m.joinedAt,
              clubId: club._id.toString(),
              clubName: club.clubName || "Unknown Club",
              location: club.location || "N/A",
              upcomingEventsCount: upcomingCount,
            };
          })
        );

        const filteredJoinedClubs = joinedClubs.filter((c) => c !== null);

        res.send(filteredJoinedClubs);
      } catch (err) {
        console.error("Fetch joined clubs error:", err);
        res.status(500).send({ message: "Failed to fetch joined clubs" });
      }
    });
  

    
    // Returns all events that a member is registered for
    app.get("/member/register/events", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email || req.decoded_email;
        if (!userEmail) {
          return res.status(400).send({ message: "User email is required." });
        }

        const registrations = await eventRegistrationsCollection
          .find({
            userEmail,
            status: { $ne: "cancelled" },
          })
          .toArray();

        if (registrations.length === 0) return res.send([]);

        const eventIds = registrations.map((r) => r.eventId);

        const events = await eventsCollection
          .find({ _id: { $in: eventIds } })
          .toArray();

        const finalEvents = await Promise.all(
          events.map(async (event) => {
            const club = await clubsCollection.findOne({ _id: event.clubId });
            const isRegistered = registrations.some(
              (r) => r.eventId.toString() === event._id.toString()
            );

            return {
              ...event,
              clubName: club?.clubName || "Unknown Club",
              isRegistered,
            };
          })
        );

        res.send(finalEvents);
      } catch (err) {
        console.error("Member events error:", err);
        res.status(500).send({ message: "Failed to load events" });
      }
    });

    // role apis

    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;

        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.json({ role: "user" });
        }

        res.json({ role: user.role || "user" });
      } catch (error) {
        console.error("Error fetching user role:", error);

        res.json({ role: "user" });
      }
    });

    app.get(
      "/member/all/payments",
      verifyFBToken,
      verifyMember,
      async (req, res) => {
        try {
          const email = req.decoded_email;

          // Fetch all payments by this member
          const payments = await paymentCollection
            .find({ userEmail: email })
            .sort({ createdAt: -1 })
            .toArray();

          res.send({ payments });
        } catch (err) {
          console.error("Fetch member payments error:", err);
          res.status(500).send({ message: "Failed to fetch payments" });
        }
      }
    );

    //******************************************************************************** */
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
