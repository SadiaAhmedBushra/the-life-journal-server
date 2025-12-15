require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ObjectId, MongoClient, ServerApiVersion } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./the-life-journal-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email; 
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lpz93gz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const today = new Date();
const day = today.getDay();
const diff = today.getDate() - day + (day === 0 ? -6 : 1);
const monday = new Date(today.setDate(diff));
monday.setHours(0, 0, 0, 0);

async function run() {
  try {
    await client.connect();
    const db = client.db("the-life-journal-db");
    const lessonCollection = db.collection("lessons");
    const userCollection = db.collection("users");
    const commentCollection = db.collection("comments");
    const reportCollection = db.collection("lessonReports");

    const verifyLessonOwnerOrAdmin = async (req, res, next) => {
  const lessonId = req.params.id;
  const email = req.tokenEmail;

  const lesson = await lessonCollection.findOne({
    _id: new ObjectId(lessonId),
  });

  if (!lesson) {
    return res.status(404).send({ message: "Lesson not found" });
  }

  const user = await userCollection.findOne({ email });

  const isOwner = lesson.email === email;
  const isAdmin = user?.role === "admin";

  if (!isOwner && !isAdmin) {
    return res.status(403).send({ message: "Forbidden action" });
  }

  next();
};

    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await userCollection.findOne({ email });

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Only Admin can access" });
      }
      next();
    };

    // get lesson, and filtering for similar lessons
    app.get("/lessons", async (req, res) => {
      try {
        const query = {};

        if (req.query.email) query.email = req.query.email;

        const { category, emotionalTone, privacy } = req.query;

        if (privacy) {
          query.privacy = privacy;
        }

        if (category && emotionalTone) {
          query.$or = [{ category }, { emotionalTone }];
        } else if (category) {
          query.category = category;
        } else if (emotionalTone) {
          query.emotionalTone = emotionalTone;
        }

        const limit = parseInt(req.query.limit) || 0;

        const options = {
          sort: { createdAt: -1 },
          ...(limit > 0 && { limit }),
        };

        const lessons = await lessonCollection.find(query, options).toArray();
        res.send(lessons);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch lessons" });
      }
    });

    // get admin dashboard homepage overviews
    app.get(
      "/admin/analytics",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const totalUsers = await userCollection.countDocuments();

        const publicLessons = await lessonCollection.countDocuments({
          privacy: "public",
        });

        const flaggedLessons = await reportCollection.countDocuments();

        const todayLessons = await lessonCollection.countDocuments({
          createdAt: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        });

        const topContributor = await lessonCollection
          .aggregate([
            { $group: { _id: "$email", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 },
          ])
          .toArray();

        res.send({
          totalUsers,
          publicLessons,
          flaggedLessons,
          todayLessons,
          topContributor: topContributor[0]?._id || "N/A",
        });
      }
    );

    // GET lesson by ID
    app.get("/lessons/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const lesson = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!lesson)
          return res.status(404).send({ message: "Lesson not found" });
        res.send(lesson);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Invalid lesson ID format" });
      }
    });

    // POST new lesson
    app.post("/lessons", async (req, res) => {
      try {
        const lesson = req.body;
        const result = await lessonCollection.insertOne(lesson);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to create lesson" });
      }
    });

    // DELETE lesson by ID
    // app.delete("/lessons/:id", async (req, res) => {
    app.delete(
      "/lessons/:id",
      verifyFBToken,
      verifyLessonOwnerOrAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await lessonCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ error: "Failed to delete lesson" });
        }
      }
    );

    //  save or update user
    app.post("/users", async (req, res) => {
      const userData = req.body;

      userData.createdAt = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = "freeUser";

      const userQuery = { email: userData.email };

      const alreadyExists = await userCollection.findOne(userQuery);

      if (alreadyExists) {
        const result = await userCollection.updateOne(userQuery, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }
      const result = await userCollection.insertOne(userData);
      res.send(result);

      console.log(userData);
    });

    // payment api
    app.post("/payment-checkout-session", verifyFBToken, async (req, res) => {
      // app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: paymentInfo?.name,
                },
                unit_amount: paymentInfo?.price * 100,
              },
              quantity: paymentInfo?.quantity,
            },
          ],
          mode: "payment",
          metadata: {
            customer: paymentInfo?.email,
          },
          success_url: `${process.env.SITE_DOMAIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment/cancelled`,
        });
        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe checkout session error:", error);
      }
    });

    app.patch("/payment/success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      console.log("session retrieved", session);

      if (session.payment_status === "paid") {
        const email = session.metadata.customer;

        const result = await userCollection.updateOne(
          { email: email },
          {
            $set: {
              paymentStatus: "Paid",
              role: "Premium",
            },
          }
        );

        return res.send({ success: true, updated: result });
      }

      res.send({ success: false });
    });

    // get user role and paymentStatus
    app.get("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await userCollection.findOne({ email });
        if (!user) return res.status(404).send({ error: "User not found" });

        res.send({
          role: user.role || "user",
          paymentStatus: user.paymentStatus || "unpaid",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch user role" });
      }
    });

    //  get lesson
    app.get("/lessons/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "Lesson not found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Invalid ID format" });
      }
    });

    // edit lesson
    // app.put("/lessons/:id", async (req, res) => {
    app.put(
      "/lessons/:id",
      verifyFBToken,
      verifyLessonOwnerOrAdmin,
      async (req, res) => {
        const lessonId = req.params.id;

        if (!ObjectId.isValid(lessonId)) {
          return res.status(400).send({ error: "Invalid lesson ID format" });
        }

        const updateData = req.body;
        const { _id, ...fieldsToUpdate } = updateData; // prevent _id updates
        fieldsToUpdate.updatedAt = new Date();

        try {
          const filter = { _id: new ObjectId(lessonId) };
          const updateResult = await lessonCollection.updateOne(filter, {
            $set: fieldsToUpdate,
          });

          if (updateResult.matchedCount === 0) {
            return res.status(404).send({ message: "Lesson not found" });
          }

          const updatedLesson = await lessonCollection.findOne(filter);

          res.send(updatedLesson);
        } catch (error) {
          console.error("Failed to update lesson:", error);
          res.status(500).send({ error: "Failed to update lesson" });
        }
      }
    );

    // PATCH toggle like
    app.patch("/lessons/:id/like", async (req, res) => {
      try {
        const lessonId = req.params.id;
        const { userId } = req.body;
        if (!userId) return res.status(400).send({ error: "Missing userId" });

        const lesson = await lessonCollection.findOne({
          _id: new ObjectId(lessonId),
        });
        if (!lesson) return res.status(404).send({ error: "Lesson not found" });

        const likes = lesson.likes || [];
        const userHasLiked = likes.includes(userId);

        const update = userHasLiked
          ? { $pull: { likes: userId }, $inc: { likesCount: -1 } }
          : { $addToSet: { likes: userId }, $inc: { likesCount: 1 } };

        await lessonCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          update
        );

        res.send({
          success: true,
          liked: !userHasLiked,
          likesCountChange: userHasLiked ? -1 : 1,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to toggle like" });
      }
    });

    // PATCH toggle favorite
    app.patch("/lessons/:id/favorite", async (req, res) => {
      try {
        const lessonId = req.params.id;
        const { userId } = req.body;
        if (!userId) return res.status(400).send({ error: "Missing userId" });

        const lesson = await lessonCollection.findOne({
          _id: new ObjectId(lessonId),
        });
        if (!lesson) return res.status(404).send({ error: "Lesson not found" });

        const favorites = lesson.favorites || [];
        const userHasFavorited = favorites.includes(userId);

        const update = userHasFavorited
          ? { $pull: { favorites: userId }, $inc: { favoritesCount: -1 } }
          : { $addToSet: { favorites: userId }, $inc: { favoritesCount: 1 } };

        await lessonCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          update
        );

        res.send({
          success: true,
          favorited: !userHasFavorited,
          favoritesCountChange: userHasFavorited ? -1 : 1,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to toggle favorite" });
      }
    });

    // post fpr report
    app.post("/lessons/:id/report", async (req, res) => {
      const { reporterUserId, reason } = req.body;

      if (!reporterUserId || !reason) {
        return res
          .status(400)
          .send({ error: "Missing reporterUserId or reason" });
      }

      const reportCollection = client
        .db("the-life-journal-db")
        .collection("lessonReports");

      const doc = {
        lessonId: new ObjectId(req.params.id),
        reporterUserId,
        reason,
        timestamp: new Date(),
      };

      await reportCollection.insertOne(doc);

      res.send({ success: true, message: "Report submitted successfully" });
    });

    const pipeline = [
      {
        $addFields: {
          createdAtDate: { $toDate: "$createdAt" },
        },
      },
      {
        $match: { createdAtDate: { $gte: monday } },
      },
      {
        $group: { _id: "$email", lessonsCount: { $sum: 1 } },
      },
      { $sort: { lessonsCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "email",
          as: "userInfo",
        },
      },
      { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userEmail: "$_id",
          lessonsCount: 1,
          name: "$userInfo.name",
          _id: 0,
        },
      },
    ];

    app.get("/analytics/most-saved-lessons", async (req, res) => {
      try {
        const lessons = await lessonCollection
          .find({
            favoritesCount: { $gt: 0 },
          })
          .sort({ favoritesCount: -1 })
          .limit(3)
          .toArray();

        res.send(lessons);
      } catch (error) {
        console.error("Failed to fetch most saved lessons:", error);
        res.status(500).send({ message: "Failed to fetch most saved lessons" });
      }
    });

    // get for top contributors
    app.get("/analytics/top-contributors-week", async (req, res) => {
      try {
        const pipeline = [
          {
            $addFields: {
              createdAtDate: { $toDate: "$createdAt" },
            },
          },
          {
            $match: { createdAtDate: { $gte: monday } },
          },
          {
            $group: { _id: "$email", lessonsCount: { $sum: 1 } },
          },
          { $sort: { lessonsCount: -1 } },
          { $limit: 3 },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "email",
              as: "userInfo",
            },
          },
          { $unwind: { path: "$userInfo", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              userEmail: "$_id",
              lessonsCount: 1,
              name: "$userInfo.name",
              _id: 0,
            },
          },
        ];

        const topContributors = await lessonCollection
          .aggregate(pipeline)
          .toArray();
        res.json(topContributors);
      } catch (error) {
        console.error("Failed to fetch top contributors:", error);
        res.status(500).json({ message: "Failed to fetch top contributors" });
      }
    });

    // get favorited lessons by a user
    app.get("/users/favorites/:email", async (req, res) => {
      try {
        const email = req.params.email;
        if (!email)
          return res.status(400).send({ error: "Missing user email" });

        // Find lessons where favorites array includes this user email
        const favorites = await lessonCollection
          .find({ favorites: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(favorites);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch user's favorites" });
      }
    });

    // post new comment
    app.post("/comments", async (req, res) => {
      try {
        const comment = req.body;
        if (!comment.lessonId || !comment.userId || !comment.text)
          return res
            .status(400)
            .send({ error: "Missing required comment fields" });

        comment.createdAt = new Date().toISOString();
        const result = await commentCollection.insertOne(comment);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to post comment" });
      }
    });

    // get comments for a lesson
    app.get("/comments", async (req, res) => {
      try {
        const { lessonId } = req.query;
        if (!lessonId)
          return res.status(400).send({ error: "Missing lessonId query" });

        const comments = await commentCollection
          .find({ lessonId })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(comments);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to fetch comments" });
      }
    });

    // DELETE comment by ID
    app.delete("/comments/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await commentCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Failed to delete comment" });
      }
    });

    app.get("/", (req, res) => {
      res.send("Welcome to The Life Journal!");
    });

    // Start server
    app.listen(port, () => {
      console.log(`The Life Journal is listening on port ${port}`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
