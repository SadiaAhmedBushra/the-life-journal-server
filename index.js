require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const app = express();
const { MongoClient, ServerApiVersion } = require("mongodb");

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// const verifyFBToken = (req, res, next) => {
//   console.log('headers in the Middleware', req.headers.authorization)
//   const token = req.headers.authorization;
//   if(!token)
//   {
//     return res.status(401).send({message: 'unauthorized access'})
//   }
// next();
// }

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lpz93gz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("the-life-journal-db");
    const lessonCollection = db.collection("lessons");
    const userCollection = db.collection("users");

    console.log("STRIPE", process.env.STRIPE_SECRET);

    // lesson api
    app.get("/lessons", async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;
        console.log("QUERY EMAIL:", email);

        if (email) {
          query.email = email;
        }

        const options = { sort: { createdAt: -1 } };

        // all lessons
        const allLessons = await lessonCollection.find({}).toArray();
        console.log("All Lessons:", allLessons);

        // filtered lessons
        const result = await lessonCollection.find(query, options).toArray();
        console.log("Lessons Filtered by User Email:", result);

        res.send(result);
      } catch (error) {
        console.error("Error fetching lessons:", error);
        res.status(500).send({ error: "Failed to fetch lessons" });
      }
    });

    // post lesson
    app.post("/lessons", async (req, res) => {
      const lesson = req.body;
      console.log(lesson);
      const result = await lessonCollection.insertOne(lesson);
      res.send(result);
    });

    // delete lesson
    app.delete("/lessons/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await lessonCollection.deleteOne(query);
      res.send(result);
    });

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

    // user role
    //   app.get("/users/role/:email", async (req, res) => {
    //     const email = req.params.email;
    //     const query = { email: email };
    //     const user = await userCollection.findOne(query);
    //     res.send({ role: user?.role,
    //   // paymentStatus: user?.paymentStatus || "unpaid",
    //  });
    //   });

    // user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };

      // console.log('headers', req.headers);

      const user = await userCollection.findOne(query);

      if (!user) {
        return res.send({
          role: "General",
          paymentStatus: "Unpaid",
        });
      }

      res.send({
        role: user.role,
        paymentStatus: user.paymentStatus || "Unpaid",
      });
    });

    // patch for like
    app.patch("/lessons/:id/like", async (req, res) => {
      const lessonId = req.params.id;
      const { userId } = req.body; // email

      if (!userId) {
        return res.status(400).send({ error: "Missing userId" });
      }

      try {
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
      } catch (err) {
        res.status(500).send({ error: "Failed to toggle like" });
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

    // payment api - module
    // app.post("/payment-checkout-session", verifyFBToken, async (req, res) => {
    // app.post("/payment-checkout-session", async (req, res) => {
    //   const paymentInfo = req.body;

    //   try {
    //     const session = await stripe.checkout.sessions.create({
    //       line_items: [
    //         {
    //           price_data: {
    //             currency: "usd",
    //             product_data: {
    //               name: paymentInfo?.name,
    //             },
    //             unit_amount: paymentInfo?.price * 100,
    //           },
    //           quantity: paymentInfo?.quantity,
    //         },
    //       ],
    //       mode: "payment",
    //       metadata: {
    //         customer: paymentInfo?.email,
    //       },
    //       success_url: `${process.env.SITE_DOMAIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    //       cancel_url: `${process.env.SITE_DOMAIN}/payment/cancelled`,
    //     });

    //     res.send({ url: session.url });
    //   } catch (error) {
    //     console.error("Stripe checkout session error:", error);
    //   }
    // });

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
    app.put("/lessons/:id", async (req, res) => {
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
    });

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

app.get("/", (req, res) => {
  res.send("Welcome to The Life Journal!");
});

app.listen(port, () => {
  console.log(`The Life Journal is listening on port ${port}`);
});
