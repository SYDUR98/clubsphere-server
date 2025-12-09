const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

    app.get("/clubs", async (req, res) => {
      try {
        

        let query = { status: "approved" };

        const clubs = await clubsCollection.find(query).toArray();

        res.send(clubs);
      } catch (err) {
        console.error("Fetch clubs error:", err);
        res.status(500).send({ message: "Failed to fetch clubs" });
      }
    });

    //------------------------------------------------------------------------------
    // Join club (Free / Paid)
    app.post("/clubs/join/:clubId", async (req, res) => {
      const { clubId } = req.params;
      const { userEmail } = req.body;

      if (!userEmail)
        return res.status(400).send({ message: "User email required" });
      if (!ObjectId.isValid(clubId))
        return res.status(400).send({ message: "Invalid club ID" });

      const club = await clubsCollection.findOne({ _id: new ObjectId(clubId) });
      if (!club) return res.status(404).send({ message: "Club not found" });

      const existing = await membershipsCollection.findOne({
        userEmail,
        clubId: club._id,
      });
      if (existing) return res.status(400).send({ message: "Already joined" });

      const fee = Number(club.membershipFee) || 0;

      // Free club
      if (fee === 0) {
        await membershipsCollection.insertOne({
          userEmail,
          clubId: club._id,
          status: "active",
          joinedAt: new Date(),
        });
        return res.send({ message: "Joined free club" });
      }

      // Paid club -> create Stripe checkout
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: club.clubName },
              unit_amount: fee * 100,
            },
            quantity: 1,
          },
        ],
        metadata: { userEmail, clubId: club._id.toString() },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url, sessionId: session.id });
    });

    //-------------------------------------------------------------------------------
    
    // Payment success 
    app.post("/payments/confirm", async (req, res) => {
      const { sessionId } = req.body;

      if (!sessionId)
        return res.status(400).send({ message: "Missing sessionId" });

      try {
        // Stripe থেকে session verify
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed" });
        }

        const { userEmail, clubId } = session.metadata;
        const amount = session.amount_total / 100; // cents to dollars

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
    //================================================================================
    //                    Admin apis
    //================================================================================
    // Admin Stats API
    app.get("/admin/stats", async (req, res) => {
      try {
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

        //  payments collection later
        const totalPayments = 0;

        res.send({
          totalUsers,
          totalClubs,
          pendingClubs,
          approvedClubs,
          rejectedClubs,
          totalEvents,
          totalPayments,
        });
      } catch (err) {
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

    //================================================================================
    //              Manager apis
    //================================================================================
    //club related apis
    app.post("/clubs", async (req, res) => {
      try {
        const {
          clubName,
          description,
          category,
          location,
          bannerImage,
          membershipFee,
          managerEmail,
          status,
          createdAt,
        } = req.body;

        // validation
        if (
          !clubName ||
          !description ||
          !category ||
          !location ||
          !bannerImage ||
          membershipFee == null ||
          !managerEmail
        ) {
          return res.status(400).json({ message: "All fields are required" });
        }

        const newClub = {
          clubName,
          description,
          category,
          location,
          bannerImage,
          membershipFee,
          managerEmail,
          status: status || "pending",
          createdAt: createdAt || new Date(),
        };

        const result = await clubsCollection.insertOne(newClub);

        res.status(201).json({
          message: "Club created successfully",
          clubId: result.insertedId,
          club: newClub,
        });
      } catch (error) {
        console.error("Error creating club:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Get My Clubs
    app.get("/clubs/manager/:email", async (req, res) => {
      const email = req.params.email;
      const result = await clubsCollection
        .find({ managerEmail: email })
        .toArray();
      res.send(result);
    });

    // Edit Club
    app.patch("/clubs/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const data = { ...req.body };

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid club ID" });
        }

        // Remove _id if it exists, keep createdAt as it is
        delete data._id;

        // Convert membershipFee to number if it exists
        if (data.membershipFee) {
          data.membershipFee = Number(data.membershipFee);
        }

        const result = await clubsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...data,
              updatedAt: new Date(), // Only update updatedAt
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Club not found" });
        }

        res.status(200).json({ message: "Club updated successfully" });
      } catch (err) {
        console.error("PATCH ERROR:", err);
        res.status(500).json({ message: "Update failed", error: err.message });
      }
    });
    // delete pais
    app.delete("/clubs/:id", async (req, res) => {
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

    // event apis

    // Create Event
    app.post("/events", async (req, res) => {
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

        if (!title || !description || !eventDate || !location || !clubId) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const data = {
          title,
          description,
          eventDate: new Date(eventDate),
          location,
          isPaid: !!isPaid,
          maxAttendees: maxAttendees ? Number(maxAttendees) : null,
          createdAt: new Date(),
          clubId: new ObjectId(clubId),
        };

        if (isPaid) {
          if (!eventFee || isNaN(eventFee)) {
            return res
              .status(400)
              .json({ message: "Event fee is required for paid events" });
          }
          data.eventFee = Number(eventFee);
        }

        const result = await eventsCollection.insertOne(data);
        res
          .status(201)
          .json({ message: "Event created", eventId: result.insertedId });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .json({ message: "Failed to create event", error: err.message });
      }
    });

    // Get Events
    app.get("/events", async (req, res) => {
      try {
        // const clubId = req.params.clubId;
        const events = await eventsCollection.find().toArray();
        res.json(events);
      } catch (err) {
        res.status(500).json({ message: "Failed to fetch events" });
      }
    });
    // delete events
    app.delete("/events/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await eventsCollection.deleteOne(query);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Delete failed" });
      }
    });

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

    //================================================================================
    //              Member apis
    //================================================================================

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
